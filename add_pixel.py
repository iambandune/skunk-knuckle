import os

pixel_code = '''    <!-- Meta Pixel Code -->
    <script>
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '1606811770633230');
    fbq('track', 'PageView');
    </script>
    <noscript><img height="1" width="1" style="display:none"
    src="https://www.facebook.com/tr?id=1606811770633230&ev=PageView&noscript=1"
    /></noscript>
    <!-- End Meta Pixel Code -->'''

pixel_purchase = '''    <!-- Meta Pixel Code -->
    <script>
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '1606811770633230');
    fbq('track', 'PageView');
    fbq('track', 'Purchase', {currency: 'USD', value: 0});
    </script>
    <noscript><img height="1" width="1" style="display:none"
    src="https://www.facebook.com/tr?id=1606811770633230&ev=PageView&noscript=1"
    /></noscript>
    <!-- End Meta Pixel Code -->'''

updates = [
    ('index.html', 'apple-mobile-web-app-status-bar-style" content="black-translucent" />', pixel_code),
    ('intake.html', 'twitter:image" content="/og-card.png?v=8" />', pixel_code),
    ('samples.html', 'twitter:image" content="/og-card.png?v=8" />', pixel_code),
    ('coming_soon.html', 'twitter:image" content="/og-card.png?v=8" />', pixel_code),
    ('success.html', 'og:image" content="/og-card.png?v=8" />', pixel_purchase),
]

for fn, marker, code in updates:
    path = os.path.join(os.path.dirname(__file__), fn)
    if not os.path.exists(path):
        print(f"✗ {fn} not found")
        continue
    with open(path, 'r') as f:
        content = f.read()
    if 'Meta Pixel' in content:
        print(f"⏭ {fn} already has pixel")
    elif marker in content:
        content = content.replace(marker, marker + '\n' + code)
        with open(path, 'w') as f:
            f.write(content)
        print(f"✓ Added pixel to {fn}")
    else:
        print(f"✗ {fn} - marker not found")

print("\nDone! Run 'python3 -m http.server 8000' to test locally")
