# journals-studio.com — repo notes

Static site on Cloudflare Pages. No framework, no build step.

## Pages

| File | Served at | Role |
|---|---|---|
| `index.html` | `/` | Hub — two doors: mix & master, store |
| `mix.html` | `/mix` | Mixing/mastering landing page. **Ad destination.** Its job is lead conversion. |
| `store.html` | `/store` | Products: sample pack, plugin waitlist |
| `success.html` | `/success` | Post-purchase |
| `privacy.html` | `/privacy` | Privacy policy |

`_redirects` maps the legacy paths `/mixing`, `/samples`, `/intake`, `/coming_soon`.

## Functions

`functions/api/` — `intake.js` (mix enquiry + Meta CAPI), `waitlist.js` (store
signups), `checkout.js` (Stripe), `verify-session.js`, `download.js` (signed R2 URLs).

Required bindings: `RESEND_API_KEY`, `META_ACCESS_TOKEN`, `STRIPE_SECRET_KEY`,
`DOWNLOAD_SECRET`, `SAMPLES_BUCKET`. `DOWNLOAD_SECRET` fails closed by design.

## Credits

Do not hand-edit the credit grids in `mix.html`. They are generated between
`<!-- CREDITS:FEATURED -->` / `<!-- CREDITS:REST -->` marker pairs by:

    python3 tools/build_credits.py

Add an entry to `tools/credits.json` with a Spotify link and a label; the script
resolves the title, cover art and Apple Music link. Markers are paired for a
reason — an unpaired lookahead matches a `</div>` inside the first card.

## Tracking

Meta pixel `2076925979518264` on every page. `PageView` on load.
`Lead` fires **only** on a successful mix intake submission — never on page load,
and never for store signups (those fire `Subscribe`, so campaign optimisation
is not polluted by free email captures).

## Design

Sky-to-sunset gradient, `background-attachment: fixed`, all UI text lowercase,
glass cards. Cards use a dark translucent fill for text contrast against the
pale band of the gradient.
