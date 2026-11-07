/**
 * Private client tracker API. Single user: one password, one cookie.
 *
 * Required bindings - set in Cloudflare dashboard for BOTH Production
 * and Preview (Pages -> journals-studio -> Settings):
 *   TRACKER_PASSWORD   (secret)      the login password
 *   CLIENTS_DB         (D1 binding)  the tracker database
 * Optional:
 *   ANTHROPIC_API_KEY  (secret)      turns on the on-page assistant
 *   ANTHROPIC_BASE_URL (var)         test override for the API origin
 *
 * Until the two required ones exist every route answers 503
 * {error:'setup', missing:[...]} and the page shows setup instructions.
 *
 * Auth model: POST auth compares sha256(sent) to sha256(secret) - digest
 * comparison so string compare timing reveals nothing about the password
 * itself - then sets an HttpOnly cookie `v1.<expiry>.<hmac>` signed with
 * HMAC-SHA256 keyed on the password. Changing the password invalidates
 * every session. Cookie is scoped to Path=/api/clients so it never rides
 * along to the public site or its APIs.
 *
 * Data model v2: `projects` rows carry the current state (status,
 * revision, notes); `events` is the dated history per project (stems in,
 * sent rN, notes in, delivered, free note) that the timeline draws;
 * `clients` is per-artist info keyed on lower(trim(artist)) - pro level
 * 0-3 and contact channels. The old stems_received/last_sent columns were
 * folded into events once (meta.migrated_dates) and are no longer written.
 *
 * No CORS headers on purpose: same-origin only.
 */

const COOKIE = 'jclients';
const SESSION_DAYS = 30;

const SERVICES = new Set(['mix-and-master', 'stem-master', 'coproduction']);
const STATUSES = new Set(['awaiting-stems', 'mixing', 'sent', 'revisions', 'delivered']);
const EVENT_TYPES = new Set(['stems', 'sent', 'notes', 'delivered', 'note']);
const CHANNELS = ['text', 'instagram', 'email'];

const ASSISTANT_MODEL = 'claude-sonnet-5-5';

const enc = new TextEncoder();

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
}

async function sessionValid(request, env) {
  const raw = readCookie(request);
  if (!raw) return false;
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const exp = parseInt(parts[1], 10);
  if (!exp || Date.now() > exp) return false;
  const expect = await hmacHex(env.TRACKER_PASSWORD, 'v1.' + parts[1]);
  return expect === parts[2];
}

async function sessionCookie(env) {
  const exp = Date.now() + SESSION_DAYS * 86400 * 1000;
  const sig = await hmacHex(env.TRACKER_PASSWORD, 'v1.' + exp);
  return `${COOKIE}=v1.${exp}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/api/clients; Max-Age=${SESSION_DAYS * 86400}`;
}

const CLEAR_COOKIE = `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/clients; Max-Age=0`;

// ── schema ──────────────────────────────────────────────────────────

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          artist TEXT NOT NULL,
          track TEXT NOT NULL DEFAULT '',
          service TEXT NOT NULL DEFAULT 'mix-and-master',
          status TEXT NOT NULL DEFAULT 'awaiting-stems',
          revision INTEGER NOT NULL DEFAULT 0,
          stems_received TEXT,
          last_sent TEXT,
          notes TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`).run();
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          date TEXT NOT NULL,
          type TEXT NOT NULL,
          revision INTEGER,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        )`).run();
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS clients (
          name_key TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          pro INTEGER NOT NULL DEFAULT 0,
          channels TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`).run();
      await db.prepare(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`).run();

      // one-shot: fold the v1 date columns into the timeline, then never again
      // (re-running would resurrect events the user has since deleted)
      const done = await db.prepare(`SELECT v FROM meta WHERE k = 'migrated_dates'`).first();
      if (!done) {
        await db.prepare(`
          INSERT INTO events (id, project_id, date, type, revision, note, created_at)
          SELECT lower(hex(randomblob(16))), p.id, p.stems_received, 'stems', NULL, '', p.created_at
          FROM projects p
          WHERE p.stems_received IS NOT NULL AND p.stems_received != ''`).run();
        await db.prepare(`
          INSERT INTO events (id, project_id, date, type, revision, note, created_at)
          SELECT lower(hex(randomblob(16))), p.id, p.last_sent, 'sent', p.revision, '', p.updated_at
          FROM projects p
          WHERE p.last_sent IS NOT NULL AND p.last_sent != ''`).run();
        await db.prepare(`INSERT OR IGNORE INTO meta (k, v) VALUES ('migrated_dates', '1')`).run();
      }
    })().catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ── field validation ────────────────────────────────────────────────

function cleanStr(v, max) {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function cleanDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined; // undefined = invalid
}

function nameKey(artist) {
  return String(artist ?? '').trim().toLowerCase();
}

function cleanChannels(v) {
  const arr = (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map(s => String(s).trim().toLowerCase());
  return CHANNELS.filter(c => arr.includes(c)).join(',');
}

/** Validate a partial body into column values. Returns {fields} or {error}. */
function validate(body, { requireArtist = false } = {}) {
  const f = {};
  if (body.artist !== undefined || requireArtist) {
    f.artist = cleanStr(body.artist, 120);
    if (!f.artist) return { error: 'artist is required' };
  }
  if (body.track !== undefined) f.track = cleanStr(body.track, 160);
  if (body.service !== undefined) {
    if (!SERVICES.has(body.service)) return { error: 'unknown service' };
    f.service = body.service;
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return { error: 'unknown status' };
    f.status = body.status;
  }
  if (body.revision !== undefined) {
    const r = Number(body.revision);
    if (!Number.isInteger(r) || r < 0 || r > 999) return { error: 'revision must be 0-999' };
    f.revision = r;
  }
  if (body.notes !== undefined) f.notes = String(body.notes ?? '').slice(0, 4000);
  if (body.archived !== undefined) f.archived = body.archived ? 1 : 0;
  return { fields: f };
}

function validateEvent(body) {
  const f = {};
  if (!EVENT_TYPES.has(body.type)) return { error: 'unknown event type' };
  f.type = body.type;
  const d = cleanDate(body.date);
  if (!d) return { error: 'date must be yyyy-mm-dd' };
  f.date = d;
  if (body.revision !== undefined && body.revision !== null) {
    const r = Number(body.revision);
    if (!Number.isInteger(r) || r < 0 || r > 999) return { error: 'revision must be 0-999' };
    f.revision = r;
  } else {
    f.revision = null;
  }
  f.note = cleanStr(body.note, 300);
  if (f.type === 'note' && !f.note) return { error: 'a note needs text' };
  return { fields: f };
}

// ── shared mutations (UI routes + assistant tools) ──────────────────

async function createProject(db, body) {
  const v = validate(body, { requireArtist: true });
  if (v.error) return { error: v.error };
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    artist: v.fields.artist,
    track: v.fields.track ?? '',
    service: v.fields.service ?? 'mix-and-master',
    status: v.fields.status ?? 'awaiting-stems',
    revision: v.fields.revision ?? 0,
    stems_received: null,
    last_sent: null,
    notes: v.fields.notes ?? '',
    archived: 0,
    created_at: now,
    updated_at: now,
  };
  await db.prepare(
    `INSERT INTO projects (id, artist, track, service, status, revision, stems_received, last_sent, notes, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.id, row.artist, row.track, row.service, row.status, row.revision,
         row.stems_received, row.last_sent, row.notes, row.archived, row.created_at, row.updated_at).run();
  // a stems date at creation is the timeline's first dot
  const stems = cleanDate(body.stems_received);
  if (stems) {
    await db.prepare(
      `INSERT INTO events (id, project_id, date, type, revision, note, created_at) VALUES (?, ?, ?, 'stems', NULL, '', ?)`
    ).bind(crypto.randomUUID(), row.id, stems, now).run();
  }
  return { project: row };
}

async function updateProject(db, id, body) {
  const existing = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!existing) return { error: 'not found', status: 404 };
  const v = validate(body);
  if (v.error) return { error: v.error };
  const f = v.fields;
  if (!Object.keys(f).length) return { error: 'nothing to update' };
  f.updated_at = new Date().toISOString();
  const cols = Object.keys(f);
  await db.prepare(`UPDATE projects SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`)
    .bind(...cols.map(c => f[c]), id).run();
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  return { project: row };
}

async function logEvent(db, projectId, body) {
  const existing = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
  if (!existing) return { error: 'not found', status: 404 };
  const v = validateEvent(body);
  if (v.error) return { error: v.error };
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    project_id: projectId,
    date: v.fields.date,
    type: v.fields.type,
    revision: v.fields.revision,
    note: v.fields.note,
    created_at: now,
  };
  await db.prepare(
    `INSERT INTO events (id, project_id, date, type, revision, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.id, row.project_id, row.date, row.type, row.revision, row.note, row.created_at).run();
  await db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, projectId).run();
  return { event: row, project_artist: existing.artist };
}

async function setClient(db, body) {
  const key = nameKey(body.artist);
  if (!key) return { error: 'artist is required' };
  const existing = await db.prepare('SELECT * FROM clients WHERE name_key = ?').bind(key).first();
  const pro = body.pro !== undefined
    ? Math.max(0, Math.min(3, Number.isInteger(Number(body.pro)) ? Number(body.pro) : 0))
    : (existing ? existing.pro : 0);
  const channels = body.channels !== undefined ? cleanChannels(body.channels) : (existing ? existing.channels : '');
  const now = new Date().toISOString();
  const name = cleanStr(body.artist, 120);
  await db.prepare(
    `INSERT INTO clients (name_key, name, pro, channels, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, pro = excluded.pro, channels = excluded.channels, updated_at = excluded.updated_at`
  ).bind(key, name, pro, channels, now).run();
  return { client: { name_key: key, name, pro, channels, updated_at: now } };
}

// ── assistant ───────────────────────────────────────────────────────

const ASSISTANT_TOOLS = [
  {
    name: 'add_project',
    description: 'add a new song/project to the board.',
    input_schema: {
      type: 'object',
      properties: {
        artist: { type: 'string' },
        track: { type: 'string' },
        service: { type: 'string', enum: [...SERVICES] },
        status: { type: 'string', enum: [...STATUSES] },
        revision: { type: 'integer' },
        notes: { type: 'string' },
        stems_received: { type: 'string', description: 'yyyy-mm-dd; also logs the stems-in timeline event' },
      },
      required: ['artist'],
    },
  },
  {
    name: 'update_project',
    description: 'change fields on an existing project. pass only what changes. archived true/false moves it off/onto the board.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'project id from the board snapshot' },
        artist: { type: 'string' },
        track: { type: 'string' },
        service: { type: 'string', enum: [...SERVICES] },
        status: { type: 'string', enum: [...STATUSES] },
        revision: { type: 'integer' },
        notes: { type: 'string' },
        archived: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'log_event',
    description: 'add a dated entry to a project timeline. types: stems (stems in), sent (mix sent - include revision), notes (feedback came back), delivered, note (free text in the note field).',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        type: { type: 'string', enum: [...EVENT_TYPES] },
        date: { type: 'string', description: 'yyyy-mm-dd' },
        revision: { type: 'integer' },
        note: { type: 'string' },
      },
      required: ['project_id', 'type', 'date'],
    },
  },
  {
    name: 'set_client',
    description: 'set per-artist client info: pro 0-3 (0 not rated, 1 casual, 2 releasing, 3 consistent - how consistently they release) and/or contact channels.',
    input_schema: {
      type: 'object',
      properties: {
        artist: { type: 'string' },
        pro: { type: 'integer', minimum: 0, maximum: 3 },
        channels: { type: 'array', items: { type: 'string', enum: CHANNELS } },
      },
      required: ['artist'],
    },
  },
];

const EVENT_LABEL = { stems: 'stems in', sent: 'sent', notes: 'notes in', delivered: 'delivered', note: 'note' };

async function execTool(db, name, input, changes) {
  try {
    if (name === 'add_project') {
      const r = await createProject(db, input || {});
      if (r.error) return { error: r.error };
      changes.push('added ' + r.project.artist + (r.project.track ? ' — ' + r.project.track : ''));
      return { ok: true, id: r.project.id };
    }
    if (name === 'update_project') {
      const r = await updateProject(db, String(input?.id || ''), input || {});
      if (r.error) return { error: r.error };
      changes.push('updated ' + r.project.artist + (r.project.track ? ' — ' + r.project.track : ''));
      return { ok: true };
    }
    if (name === 'log_event') {
      const r = await logEvent(db, String(input?.project_id || ''), input || {});
      if (r.error) return { error: r.error };
      const e = r.event;
      changes.push(r.project_artist + ': ' + (EVENT_LABEL[e.type] || e.type) + (e.type === 'sent' && e.revision !== null ? ' r' + e.revision : '') + ' · ' + e.date);
      return { ok: true, id: e.id };
    }
    if (name === 'set_client') {
      const r = await setClient(db, input || {});
      if (r.error) return { error: r.error };
      changes.push('client info: ' + r.client.name);
      return { ok: true };
    }
    return { error: 'unknown tool' };
  } catch (err) {
    console.error('assistant tool:', name, err && err.message);
    return { error: 'failed' };
  }
}

async function boardSnapshot(db) {
  const projects = (await db.prepare('SELECT * FROM projects').all()).results || [];
  const events = (await db.prepare('SELECT * FROM events ORDER BY date, created_at').all()).results || [];
  const clients = (await db.prepare('SELECT * FROM clients').all()).results || [];
  const byProject = {};
  for (const e of events) {
    (byProject[e.project_id] = byProject[e.project_id] || []).push({
      date: e.date, type: e.type, revision: e.revision, note: e.note || undefined,
    });
  }
  return {
    projects: projects.map(p => ({
      id: p.id, artist: p.artist, track: p.track, service: p.service, status: p.status,
      revision: p.revision, notes: (p.notes || '').slice(0, 300) || undefined,
      archived: p.archived ? true : undefined,
      timeline: (byProject[p.id] || []).slice(-20),
    })),
    clients: clients.map(c => ({ artist: c.name || c.name_key, pro: c.pro, channels: c.channels || undefined })),
  };
}

async function runAssistant(env, db, messages, today) {
  const board = await boardSnapshot(db);
  const system =
    "you are the assistant inside journals.' private client tracker. the user is the mix engineer and everything on the board is his own data.\n" +
    'today is ' + today + '.\n' +
    'services: mix-and-master, stem-master, coproduction. statuses in pipeline order: awaiting-stems, mixing, sent, revisions, delivered.\n' +
    'timeline event types: stems (stems came in), sent (a mix went out - carries the revision number), notes (feedback came back), delivered, note (free text).\n' +
    "client info is per artist: pro 0-3 (how consistently they release: 1 casual, 2 releasing, 3 consistent) and contact channels (text, instagram, email).\n" +
    'use the tools to make the changes he describes. match artist names loosely (case, partial), but if a name could mean two different people on the board, ask which one instead of guessing. ' +
    'when he says something happened - "sent sarah r2 yesterday" - log the timeline event with the right date and bring the project\'s status and revision in line with what he said. change only what he asked. ' +
    'relative dates ("yesterday", "last friday") count back from today.\n' +
    'answer in one or two short lowercase sentences, no markdown, no lists unless he asks.\n' +
    'the board right now:\n' + JSON.stringify(board);

  const msgs = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? '').slice(0, 4000),
  }));
  const changes = [];
  const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');

  for (let round = 0; round < 6; round++) {
    const res = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        max_tokens: 1000,
        system,
        messages: msgs,
        tools: ASSISTANT_TOOLS,
      }),
    });
    if (!res.ok) {
      console.error('assistant upstream:', res.status, (await res.text()).slice(0, 300));
      return { error: 'assistant failed', status: 502, changes };
    }
    const out = await res.json();
    if (out.stop_reason === 'tool_use') {
      const results = [];
      for (const block of out.content || []) {
        if (block.type !== 'tool_use') continue;
        const r = await execTool(db, block.name, block.input, changes);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(r) });
      }
      msgs.push({ role: 'assistant', content: out.content });
      msgs.push({ role: 'user', content: results });
      continue;
    }
    const text = (out.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return { reply: text || 'done.', changes };
  }
  return { reply: 'that took too many steps - try it in smaller pieces.', changes };
}

// ── handler ─────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env, params } = context;
  const route = (params.route || []).join('/');
  const method = request.method;

  const missing = [];
  if (!env.TRACKER_PASSWORD) missing.push('TRACKER_PASSWORD (secret)');
  if (!env.CLIENTS_DB) missing.push('CLIENTS_DB (D1 binding)');
  if (missing.length) return json({ error: 'setup', missing }, 503);

  try {
    // ── auth ──
    if (route === 'auth') {
      if (method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
        const sent = String(body.password ?? '');
        const ok = sent && (await sha256hex(sent)) === (await sha256hex(env.TRACKER_PASSWORD));
        if (!ok) {
          await new Promise(r => setTimeout(r, 400));
          return json({ error: 'wrong password' }, 401);
        }
        await ensureSchema(env.CLIENTS_DB);
        return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env) });
      }
      if (method === 'DELETE') {
        return json({ ok: true }, 200, { 'Set-Cookie': CLEAR_COOKIE });
      }
      return json({ error: 'method not allowed' }, 405);
    }

    // everything below requires a session
    if (!(await sessionValid(request, env))) return json({ error: 'unauthorized' }, 401);
    await ensureSchema(env.CLIENTS_DB);
    const db = env.CLIENTS_DB;

    // ── whole board in one read ──
    if (route === 'state') {
      if (method !== 'GET') return json({ error: 'method not allowed' }, 405);
      const projects = (await db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all()).results || [];
      const events = (await db.prepare('SELECT * FROM events ORDER BY date, created_at').all()).results || [];
      const clients = (await db.prepare('SELECT * FROM clients').all()).results || [];
      return json({ projects, events, clients });
    }

    // ── projects collection ──
    if (route === 'projects') {
      if (method === 'GET') {
        const { results } = await db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
        return json({ projects: results || [] });
      }
      if (method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
        const r = await createProject(db, body);
        if (r.error) return json({ error: r.error }, 400);
        return json(r, 201);
      }
      return json({ error: 'method not allowed' }, 405);
    }

    // ── per-artist client info ──
    if (route === 'clients') {
      if (method !== 'POST') return json({ error: 'method not allowed' }, 405);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
      const r = await setClient(db, body);
      if (r.error) return json({ error: r.error }, 400);
      return json(r);
    }

    // ── assistant ──
    if (route === 'assistant') {
      if (method !== 'POST') return json({ error: 'method not allowed' }, 405);
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'assistant-setup' }, 503);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
      const messages = Array.isArray(body.messages) ? body.messages.slice(-16) : null;
      if (!messages || !messages.length) return json({ error: 'bad request' }, 400);
      const today = cleanDate(body.today) || new Date().toISOString().slice(0, 10);
      const r = await runAssistant(env, db, messages, today);
      if (r.error) return json({ error: r.error, changes: r.changes || [] }, r.status || 500);
      return json(r);
    }

    // ── timeline events ──
    const evAdd = route.match(/^projects\/([0-9a-f-]{36})\/events$/);
    if (evAdd) {
      if (method !== 'POST') return json({ error: 'method not allowed' }, 405);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
      const r = await logEvent(db, evAdd[1], body);
      if (r.error) return json({ error: r.error }, r.status || 400);
      return json({ event: r.event }, 201);
    }

    const evOne = route.match(/^events\/([0-9a-f-]{32,36})$/);
    if (evOne) {
      if (method !== 'DELETE') return json({ error: 'method not allowed' }, 405);
      const existing = await db.prepare('SELECT * FROM events WHERE id = ?').bind(evOne[1]).first();
      if (!existing) return json({ error: 'not found' }, 404);
      await db.prepare('DELETE FROM events WHERE id = ?').bind(evOne[1]).run();
      return json({ ok: true });
    }

    // ── single project ──
    const m = route.match(/^projects\/([0-9a-f-]{36})$/);
    if (m) {
      const id = m[1];

      if (method === 'PATCH') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
        const r = await updateProject(db, id, body);
        if (r.error) return json({ error: r.error }, r.status || 400);
        return json(r);
      }

      if (method === 'DELETE') {
        const existing = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
        if (!existing) return json({ error: 'not found' }, 404);
        // Deleting is two-step on purpose: archive first, then delete from
        // the archive. Stops a mis-tap from erasing a client.
        if (!existing.archived) return json({ error: 'archive it first' }, 409);
        await db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
        await db.prepare('DELETE FROM events WHERE project_id = ?').bind(id).run();
        return json({ ok: true });
      }

      return json({ error: 'method not allowed' }, 405);
    }

    return json({ error: 'not found' }, 404);
  } catch (err) {
    console.error('clients api:', err && err.message);
    return json({ error: 'server error' }, 500);
  }
}
