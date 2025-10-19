# Journals. - Mixing & Mastering Portfolio

A professional mixing and mastering portfolio website with an interactive carousel showcasing music tracks, intake form, and pricing information.

## 🎵 Features

- **Interactive Carousel**: Beautiful vertical carousel displaying music tracks with cover art
- **Music Players**: Integrated Spotify and Apple Music players for each track
- **Contact Form**: Professional intake form with pricing modal
- **Responsive Design**: Works perfectly on desktop and mobile
- **Glass Morphism UI**: Modern design with backdrop blur effects
- **Social Media Ready**: Open Graph previews for sharing

## 📁 Package Contents

```
public/
├── index.html          # Homepage with track carousel
├── intake.html         # Contact form with pricing modal
├── coming_soon.html    # Samples page placeholder
├── pricing_sheet.html  # Pricing information modal content
├── og-card.svg        # Social media preview image
├── sweat-cover.jpg    # Asset image
└── _redirects         # Routing configuration for hosting
```

## 🚀 Deployment Options

### Option 1: Cloudflare Pages (Recommended)

1. **Create Cloudflare Account**
   - Go to [dash.cloudflare.com](https://dash.cloudflare.com/sign-up)
   - Sign up for free account

2. **Deploy via Upload**
   - Navigate to "Workers & Pages" → "Create application" → "Pages"
   - Choose "Upload assets"
   - Drag and drop the entire `public` folder
   - Set project name (e.g., "journals-portfolio")
   - Click "Create Pages"

3. **Your site will be live at**: `your-project-name.pages.dev`

### Option 2: GitHub Pages

1. **Create GitHub Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/username/repo-name.git
   git push -u origin main
   ```

2. **Enable GitHub Pages**
   - Go to repository Settings → Pages
   - Source: Deploy from branch
   - Branch: main / (root)
   - Save

3. **Your site will be live at**: `username.github.io/repo-name`

### Option 3: Netlify

1. **Create Netlify Account**
   - Go to [netlify.com](https://netlify.com)

2. **Deploy**
   - Drag and drop the `public` folder to Netlify
   - Or connect GitHub repository

3. **Your site will be live at**: `random-name.netlify.app`

### Option 4: Vercel

1. **Create Vercel Account**
   - Go to [vercel.com](https://vercel.com)

2. **Deploy**
   - Import GitHub repository
   - Or drag and drop the `public` folder

3. **Your site will be live at**: `project-name.vercel.app`

## 🛠️ Local Development

### Quick Start with Python

```bash
# Navigate to the public directory
cd public

# Start local server
python3 -m http.server 8080

# Visit: http://localhost:8080
```

### Quick Start with Node.js

```bash
# Install serve globally
npm install -g serve

# Navigate to the public directory
cd public

# Start local server
serve -p 8080

# Visit: http://localhost:8080
```

### Create Shareable Link with Cloudflare Tunnel

```bash
# Install cloudflared (if not already installed)
# macOS: brew install cloudflared
# Windows: Download from cloudflare.com

# Start local server first (port 8080)
python3 -m http.server 8080

# In another terminal, create tunnel
cloudflared tunnel --url http://localhost:8080

# Copy the generated .trycloudflare.com URL to share
```

## 🎨 Customization

### Update Track Information

Edit `index.html` and modify the track containers:

```html
<div class="track-container">
    <img src="YOUR_COVER_ART_URL" class="cover-art" alt="Your Track Name">
    <div class="label-row"><span class="label-badge">Your Label</span></div>
    <div class="track-credits">credits: your credits here</div>
    <div class="music-players">
        <!-- Update Spotify and Apple Music embed URLs -->
    </div>
</div>
```

### Update Contact Information

Edit `intake.html` and modify:
- Email address in the form action
- Any contact details or messaging

### Update Pricing

Edit `pricing_sheet.html` with your pricing structure.

### Modify Colors/Styling

The site uses CSS custom properties for easy theming. Key colors are defined in the CSS:
- Background gradient: Blue to orange
- Glass cards: Semi-transparent white with backdrop blur
- Text: White with various opacity levels

## 🔧 Technical Details

### Browser Compatibility
- Modern browsers with CSS Grid and Flexbox support
- Backdrop-filter support for glass morphism effects
- JavaScript ES6+ features

### Performance Features
- Lazy loading for embedded players
- Scroll-snap for smooth carousel navigation
- Optimized images and assets

### Accessibility
- Semantic HTML structure
- ARIA labels and roles
- Keyboard navigation support
- Screen reader friendly

## 📱 Mobile Responsiveness

The site is fully responsive with:
- Optimized carousel for touch scrolling
- Proper scaling for mobile devices
- Touch-friendly button sizes
- Readable text at all screen sizes

## 🔒 Security Considerations

- All external embeds are sandboxed
- No server-side processing required
- Static files only - no backend vulnerabilities
- HTTPS automatically provided by most hosting platforms

## 🚦 Troubleshooting

### Music Players Not Loading
- Check that Spotify/Apple Music URLs are public and embeddable
- Verify iframe sandbox permissions

### Carousel Not Smooth
- Ensure CSS scroll-snap is supported in the browser
- Check that gap property is working in flexbox

### Contact Form Not Working
- Update form action URL to your email service
- Consider using services like Formspree, Netlify Forms, or EmailJS

## 📧 Support

For questions about setup or customization, refer to your hosting platform's documentation:
- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [GitHub Pages Docs](https://docs.github.com/en/pages)
- [Netlify Docs](https://docs.netlify.com/)
- [Vercel Docs](https://vercel.com/docs)

---

**Built with ❤️ for professional music industry portfolios**