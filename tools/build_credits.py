#!/usr/bin/env python3
"""
Build the credits sections of mix.html from tools/credits.json.

Add a credit by dropping a Spotify link into credits.json:

    { "spotify": "https://open.spotify.com/track/XXXX", "label": "mau5trap" }

then run:  python3 tools/build_credits.py

For any entry missing them, the script fills in:
  - name          from Spotify oEmbed
  - cover art     from Spotify (640px), centre-cropped square, 600px q82
  - apple_embed   from the iTunes Search API, matched on artist + title

Everything it resolves is written back into credits.json, so the network
lookup only happens once per track. Re-running is cheap and idempotent.

Requires: pillow  (pip install pillow)
"""

import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "tools", "credits.json")
PAGE = os.path.join(ROOT, "mix.html")
COVERS = os.path.join(ROOT, "covers")

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    )
}

# Spotify image id prefixes: ...1e02 is 300px, ...b273 is 640px
SPOTIFY_300, SPOTIFY_640 = "ab67616d00001e02", "ab67616d0000b273"


def get(url, timeout=25):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def spotify_id(url):
    m = re.search(r"open\.spotify\.com/(?:embed/)?(track|album)/([A-Za-z0-9]+)", url)
    return (m.group(1), m.group(2)) if m else (None, None)


def oembed(spotify_url):
    q = urllib.parse.quote(spotify_url, safe="")
    return json.loads(get(f"https://open.spotify.com/oembed?url={q}"))


def spotify_artists(spotify_url):
    """Artist names from the embed page's __NEXT_DATA__ payload.

    The oEmbed endpoint returns only a title, and matching Apple Music on
    title alone picks up unrelated songs that happen to share a name.
    """
    kind, sid = spotify_id(spotify_url)
    if not sid:
        return []
    try:
        html = get(f"https://open.spotify.com/embed/{kind}/{sid}").decode("utf-8", "ignore")
        m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
        if not m:
            return []
        entity = json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]
        return [a["name"] for a in entity.get("artists", []) if a.get("name")]
    except Exception:
        return []


def fetch_cover(thumb_url, slug):
    """Download the 640px variant, centre-crop square, cap at 600px."""
    from PIL import Image

    hi = thumb_url.replace(SPOTIFY_300, SPOTIFY_640)
    try:
        raw = get(hi)
    except Exception:
        raw = get(thumb_url)

    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    m = min(w, h)
    im = im.crop(((w - m) // 2, (h - m) // 2, (w - m) // 2 + m, (h - m) // 2 + m))
    target = min(600, m)  # never upscale
    im = im.resize((target, target), Image.LANCZOS)

    os.makedirs(COVERS, exist_ok=True)
    path = os.path.join(COVERS, f"{slug}.jpg")
    im.save(path, "JPEG", quality=82, optimize=True, progressive=True)
    return path, target


def apple_embed(title, artists):
    """Apple Music embed, only when title AND artist both agree.

    Matching on title alone returned the right song name by the wrong
    artist, which is worse than no link at all.
    """
    if isinstance(artists, str):
        artists = [artists] if artists else []
    if not artists:
        return None

    def norm(x):
        return re.sub(r"[^a-z0-9]", "", (x or "").lower())

    def norm_title(x):
        # Apple appends "(feat. X)" where Spotify keeps the artist separate,
        # so compare on the base title.
        base = re.split(r"\s*[\(\[]\s*(feat|ft|with)\b", (x or ""), flags=re.I)[0]
        return norm(base)

    want_title = norm_title(title)
    want_artists = [norm(a) for a in artists if norm(a)]

    term = urllib.parse.quote(f"{artists[0]} {title}".strip())
    try:
        data = json.loads(get(f"https://itunes.apple.com/search?term={term}&entity=song&limit=10"))
    except Exception:
        return None

    for r in data.get("results", []):
        if norm_title(r.get("trackName")) != want_title:
            continue
        got = norm(r.get("artistName"))
        # accept when any credited Spotify artist appears in Apple's artist
        # string (collabs are formatted differently across the two services)
        if not any(a in got or got in a for a in want_artists):
            continue
        album = slugify(r.get("collectionName", "album"))
        return (
            f"https://embed.music.apple.com/us/album/{album}/"
            f"{r['collectionId']}?i={r['trackId']}&app=music"
        )
    return None


def spotify_embed(spotify_url):
    kind, sid = spotify_id(spotify_url)
    if not sid:
        return None
    view = "list" if kind == "album" else "minimal"
    return f"https://open.spotify.com/embed/{kind}/{sid}?utm_source=generator&theme=0&view={view}"


def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def card(c):
    """One artwork tile. Players are NOT emitted as iframes here - they are
    injected on first click so no third-party frame loads on page view."""
    apple = c.get("apple_embed") or ""
    return f"""        <div class="tile"{' data-featured="1"' if c.get('featured') else ''}>
          <button type="button" class="tileart" aria-expanded="false" aria-label="play {esc(c['name'])}"
                  data-sp="{esc(c['spotify_embed'])}" data-ap="{esc(apple)}">
            <img class="cover" loading="lazy" src="/covers/{c['slug']}.jpg" alt="{esc(c['name'])}" width="600" height="600" />
            <span class="playbadge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </span>
          </button>
          <div class="tmeta">
            <div class="tname">{esc(c['name'])}</div>
            <div class="tlabel">{esc(c['label'])}</div>
          </div>
          <div class="tcred">{esc(c.get("credits", "mixing & mastering"))}</div>
          <div class="player" hidden></div>
        </div>"""


def main():
    credits = json.load(open(DATA, encoding="utf-8"))
    changed = False

    for c in credits:
        src = c.get("spotify") or c.get("spotify_embed")
        if not src:
            print(f"  !! no spotify link for {c.get('name') or c.get('slug') or '<unknown>'} — skipped")
            continue

        needs = not c.get("name") or not c.get("slug") or not c.get("spotify_embed")
        info = None
        if needs:
            kind, sid = spotify_id(src)
            info = oembed(f"https://open.spotify.com/{kind}/{sid}")
            c.setdefault("name", info["title"].lower())
            c.setdefault("slug", slugify(info["title"]))
            c["spotify_embed"] = spotify_embed(src)
            changed = True

        c.setdefault("label", "independent")
        c.setdefault("credits", "mixing & mastering")

        if "artists" not in c:
            c["artists"] = spotify_artists(src)
            changed = True

        cover = os.path.join(COVERS, f"{c['slug']}.jpg")
        if not os.path.exists(cover):
            info = info or oembed(src)
            path, size = fetch_cover(info["thumbnail_url"], c["slug"])
            print(f"  cover  {c['slug']}.jpg  {size}x{size}  {os.path.getsize(path)//1024}KB")
            changed = True

        if "apple_embed" not in c:
            found = apple_embed(c["name"], c.get("artists", []))
            c["apple_embed"] = found
            changed = True
            print(f"  apple  {c['slug']}: {'matched' if found else 'NO MATCH — spotify only'}")

    if changed:
        json.dump(credits, open(DATA, "w", encoding="utf-8"), indent=2)

    featured = "\n".join(card(c) for c in credits if c.get("featured"))
    rest = "\n".join(card(c) for c in credits if not c.get("featured"))

    page = open(PAGE, encoding="utf-8").read()
    for marker, body in (("CREDITS:FEATURED", featured), ("CREDITS:REST", rest)):
        # Paired markers: an unpaired lookahead would stop at the first
        # </div> *inside* a generated card and duplicate the block.
        pat = re.compile(
            r"(<!-- " + marker + r" -->).*?(<!-- /" + marker + r" -->)", re.S
        )
        if not pat.search(page):
            sys.exit(f"markers for {marker} not found in mix.html")
        page = pat.sub(lambda m: m.group(1) + "\n" + body + "\n" + m.group(2), page)
    open(PAGE, "w", encoding="utf-8").write(page)

    n_f = sum(1 for c in credits if c.get("featured"))
    print(f"\nmix.html rebuilt: {n_f} featured, {len(credits) - n_f} in more credits")


if __name__ == "__main__":
    main()
