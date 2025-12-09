# AI Agent Instructions for journals. Website

## Project Overview
This is a **static HTML website** for "journals." — a mixing/mastering audio service. The site is deployed on **Cloudflare Pages** and features a portfolio of music tracks with embedded Spotify/Apple Music players.

## Architecture

### Core Pages
- **`index.html`** - Main landing page showcasing music portfolio with dual-platform (Spotify/Apple Music) embedded players
- **`intake.html`** - Client intake form that POSTs to `/api/intake` (Cloudflare Pages Function)
- **`pricing_sheet.html`** - Standalone pricing display (loaded in iframe modal from intake page)
- **`coming_soon.html`** - Placeholder/coming soon page template
- **`_redirects`** - Cloudflare Pages redirects config (redirects `/mixing` → `/`)

### Design System

**Gradient Background Pattern:**
All pages use a consistent blue-to-orange gradient:
```css
background: linear-gradient(180deg,
  #4A90E2 0%,
  #6CAFE3 25%,
  #89C4E8 40%,
  #F4B674 55%,
  #FF9F5C 70%,
  #FF7A42 85%,
  #FF6B35 100%);
```

**Text Transform Convention:**
- All UI text renders in lowercase via `html, body { text-transform: lowercase; }`
- This is a brand identity decision—preserve in all new components

**Glassmorphism UI Pattern:**
```css
background: rgba(255, 255, 255, 0.12);
border: 1px solid rgba(255, 255, 255, 0.22);
backdrop-filter: blur(10px);
```
Used for buttons, cards, overlays, and interactive elements throughout the site.

**Cloud Animation:**
Decorative clouds drift across gradient backgrounds using pure CSS:
- 4 cloud layers with staggered animation delays
- Implemented with `::before` pseudo-elements for shape complexity
- Uses `@keyframes drift` for horizontal movement

## Critical JavaScript Patterns

### Multi-Track Player System (`index.html`)
Each track has dual embedded players (Spotify + Apple Music) with platform toggle buttons:

```javascript
function setupPlayerControls(id) {
  // Toggles visibility between spotify-player${id} and apple-player${id}
  // Manages .active class on both buttons and iframes
}
```

**Important:** Player IDs follow pattern: `spotify-btn`, `spotify-btn-2`, `spotify-btn-3` etc. (first has no suffix, rest are `-N`). When adding tracks, maintain this numbering scheme.

**Spotify Single-Playback Optimization:**
The site uses Spotify's IFrame API to prevent multiple Spotify players from playing simultaneously:
- Lazy-loads iframes using `IntersectionObserver` to avoid rate limits
- Listens to `postMessage` events to detect playback state changes
- Auto-pauses previous Spotify player when a new one starts
- Controllers stored in `Map<iframe, controller>`

### Menu Overlay Pattern
All pages use a fixed hamburger menu with overlay:
```javascript
menuButton.addEventListener('click', () => {
  menuOverlay.classList.toggle('active');
  menuIcon.classList.toggle('active');
});
// Close on overlay click or ESC key
```

### Form Submission (`intake.html`)
Intake form POSTs JSON to `/api/intake` (Cloudflare Pages Function endpoint):
```javascript
fetch('/api/intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, email, phone, service, link, notes })
})
```
**Expected:** Serverless function at `/functions/api/intake.js` handles email delivery.

### Pricing Modal
Uses iframe to embed `pricing_sheet.html` with dynamic height calculation:
```javascript
function sizePricingFrame() {
  const contentHeight = doc.documentElement.scrollHeight;
  const maxH = window.innerHeight * (isMobile ? 0.88 : 0.82);
  pricingFrame.style.height = Math.min(contentHeight, maxH) + 'px';
}
```

## Development Workflows

### Adding New Music Tracks (`index.html`)
1. Copy an existing `.track-container` div block
2. Update cover art `src`, track title alt text
3. Add optional `.label-badge` if track has a record label
4. Update `track-credits` text
5. **Critical:** Increment player ID suffix (`-2`, `-3`, `-4` etc.)
6. Replace Spotify/Apple Music embed URLs with new track IDs
7. Add corresponding `setupPlayerControls('-N')` call in the DOMContentLoaded script

### Modifying the Gradient
When updating the gradient, change it in **all HTML files** to maintain consistency. The gradient is inlined in `<style>` tags, not in a shared CSS file.

### Open Graph Tags
All pages include OG tags for social media previews:
```html
<meta property="og:image" content="/og-card.png?v=8" />
```
The `?v=8` query param cache-busts the image. Increment when updating og-card.png.

## Deployment Notes

- **Host:** Cloudflare Pages
- **No Build Process:** Pure static HTML/CSS/JS (no bundler, no npm)
- **SPA Fallback:** `_redirects` uses `/* /index.html 200` for client-side routing behavior
- **Assets:** Images referenced in HTML are external (CDN URLs) or root-level files like `og-card.png`

## Common Pitfalls

1. **Don't break the lowercase text transform** - preserve `text-transform: lowercase` on `html, body`
2. **Player ID numbering** - First player has no suffix, subsequent players use `-2`, `-3`, etc. (not `-1`)
3. **Gradient consistency** - When changing colors, update all 4 HTML files
4. **Spotify API script** - Don't remove the dynamic `<script src="https://open.spotify.com/embed/iframe-api/v1">` loader
5. **Modal accessibility** - Maintain `aria-*` attributes when modifying intake form modal

## Quick Reference

- Brand name: "journals." (lowercase with period)
- Contact email: journals.mp3@gmail.com
- Deployment: Push to `main` branch auto-deploys to Cloudflare Pages
- No package.json - this is vanilla HTML/CSS/JS
