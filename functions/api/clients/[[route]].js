/**
 * Private client tracker API. Single user: one password, one cookie.
 *
 * Required bindings - set in Cloudflare dashboard for BOTH Production
 * and Preview (Pages -> journals-studio -> Settings):
 *   TRACKER_PASSWORD  (secret)      the login password
 *   CLIENTS_DB        (D1 binding)  the tracker database
 *
 * Until both exist every route answers 503 {error:'setup', missing:[...]}
 * and the page shows setup instructions instead of a login.
 *
 * Auth model: POST auth compares sha256(sent) to sha256(secret) - digest
 * comparison so string compare timing reveals nothing about the password
 * itself - then sets an HttpOnly cookie `v1.<expiry>.<hmac>` signed with
 * HMAC-SHA256 keyed on the password. Changing the password invalidates
 * every session. Cookie is scoped to Path=/api/clients so it never rides
 * along to the public site or its APIs.
 *
 * No CORS headers on purpose: same-origin only.
 */

const COOKIE = 'jclients';
const SESSION_DAYS = 30;

const SERVICES = new Set(['mix-and-master', 'stem-master', 'coproduction']);
const STATUSES = new Set(['awaiting-stems', 'mixing', 'sent', 'revisions', 'delivered']);

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
    schemaReady = db.prepare(`
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
      )`).run().catch(e => { schemaReady = null; throw e; });
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
  if (body.stems_received !== undefined) {
    const d = cleanDate(body.stems_received);
    if (d === undefined) return { error: 'stems_received must be yyyy-mm-dd' };
    f.stems_received = d;
  }
  if (body.last_sent !== undefined) {
    const d = cleanDate(body.last_sent);
    if (d === undefined) return { error: 'last_sent must be yyyy-mm-dd' };
    f.last_sent = d;
  }
  if (body.notes !== undefined) f.notes = String(body.notes ?? '').slice(0, 4000);
  if (body.archived !== undefined) f.archived = body.archived ? 1 : 0;
  return { fields: f };
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

    // ── projects collection ──
    if (route === 'projects') {
      if (method === 'GET') {
        const { results } = await db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
        return json({ projects: results || [] });
      }
      if (method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
        const v = validate(body, { requireArtist: true });
        if (v.error) return json({ error: v.error }, 400);
        const now = new Date().toISOString();
        const row = {
          id: crypto.randomUUID(),
          artist: v.fields.artist,
          track: v.fields.track ?? '',
          service: v.fields.service ?? 'mix-and-master',
          status: v.fields.status ?? 'awaiting-stems',
          revision: v.fields.revision ?? 0,
          stems_received: v.fields.stems_received ?? null,
          last_sent: v.fields.last_sent ?? null,
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
        return json({ project: row }, 201);
      }
      return json({ error: 'method not allowed' }, 405);
    }

    // ── single project ──
    const m = route.match(/^projects\/([0-9a-f-]{36})$/);
    if (m) {
      const id = m[1];
      const existing = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
      if (!existing) return json({ error: 'not found' }, 404);

      if (method === 'PATCH') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
        const v = validate(body);
        if (v.error) return json({ error: v.error }, 400);
        const f = v.fields;
        if (!Object.keys(f).length) return json({ error: 'nothing to update' }, 400);
        f.updated_at = new Date().toISOString();
        const cols = Object.keys(f);
        await db.prepare(`UPDATE projects SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`)
          .bind(...cols.map(c => f[c]), id).run();
        const row = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
        return json({ project: row });
      }

      if (method === 'DELETE') {
        // Deleting is two-step on purpose: archive first, then delete from
        // the archive. Stops a mis-tap from erasing a client.
        if (!existing.archived) return json({ error: 'archive it first' }, 409);
        await db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
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
