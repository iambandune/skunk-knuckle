/**
 * Verify Session API - Cloudflare Pages Function
 * 
 * Verifies a Stripe checkout session and returns download links.
 * Sends backup download links via email using Resend.
 * 
 * Environment Variables Required:
 * - STRIPE_SECRET_KEY: Your Stripe secret key
 * - R2_BUCKET: (optional) R2 bucket binding for file storage
 * - DOWNLOAD_SECRET: Secret for signing download URLs
 * - RESEND_API_KEY: Resend API key for sending emails
 */

export async function onRequestGet(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'Missing session_id' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Retrieve the checkout session from Stripe
    const session = await getStripeCheckoutSession(env.STRIPE_SECRET_KEY, sessionId);

    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Verify payment was successful
    if (session.payment_status !== 'paid') {
      return new Response(
        JSON.stringify({ error: 'Payment not completed' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Build download links based on purchased items
    const siteUrl = env.SITE_URL || 'https://journals-studio.com';
    const downloads = await generateDownloadLinks(session, env);

    // Get customer email
    const customerEmail = session.customer_details?.email || session.customer_email;
    const orderId = session.id.slice(-8).toUpperCase();

    // Send backup download email (don't block the response if it fails)
    if (customerEmail && env.RESEND_API_KEY) {
      try {
        await sendDownloadEmail({
          resendApiKey: env.RESEND_API_KEY,
          to: customerEmail,
          orderId,
          downloads,
          siteUrl,
        });
      } catch (emailError) {
        console.error('Failed to send download email:', emailError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        orderId,
        email: customerEmail,
        total: session.amount_total,
        currency: session.currency,
        downloads,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Verify session error:', error);
    
    return new Response(
      JSON.stringify({ error: error.message || 'Verification failed' }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * Send download links email via Resend
 */
async function sendDownloadEmail({ resendApiKey, to, orderId, downloads, siteUrl }) {
  const downloadLinksHtml = downloads.map(d => {
    // Encode & as &amp; for HTML email compatibility
    const safeUrl = (siteUrl.replace(/\/+$/, '') + d.url).replace(/&/g, '&amp;');
    return '<tr>' +
      '<td style="padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">' +
        '<div style="font-size: 16px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">' + d.name + '</div>' +
        '<div style="font-size: 13px; color: rgba(255,255,255,0.5); margin-bottom: 12px;">' + d.size + '</div>' +
        '<a href="' + safeUrl + '" style="display: inline-block; padding: 10px 24px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500;">download</a>' +
      '</td>' +
    '</tr>';
  }).join('');

  const html =
    '<!DOCTYPE html>' +
    '<html>' +
    '<body style="margin: 0; padding: 0; background-color: #1a1a2e; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(180deg, #4A90E2 0%, #6CAFE3 25%, #89C4E8 40%, #F4B674 55%, #FF9F5C 70%, #FF7A42 85%, #FF6B35 100%); padding: 40px 20px;">' +
        '<tr>' +
          '<td align="center">' +
            '<table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background: rgba(0,0,0,0.6); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); overflow: hidden;">' +
              '<tr>' +
                '<td style="padding: 32px 32px 16px; text-align: center;">' +
                  '<div style="font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">journals.</div>' +
                  '<div style="font-size: 13px; color: rgba(255,255,255,0.5); margin-top: 4px;">your download is ready</div>' +
                '</td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding: 0 32px 24px;">' +
                  '<div style="background: rgba(255,255,255,0.08); border-radius: 10px; padding: 16px; text-align: center;">' +
                    '<div style="font-size: 12px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px;">order</div>' +
                    '<div style="font-size: 18px; font-weight: 600; color: #ffffff; margin-top: 4px;">#' + orderId + '</div>' +
                  '</div>' +
                '</td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding: 0 32px 32px;">' +
                  '<table width="100%" cellpadding="0" cellspacing="0">' +
                    downloadLinksHtml +
                  '</table>' +
                '</td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding: 24px 32px; border-top: 1px solid rgba(255,255,255,0.08); text-align: center;">' +
                  '<div style="font-size: 12px; color: rgba(255,255,255,0.35); line-height: 1.6;">' +
                    'download links expire in 24 hours.<br>' +
                    'need help? reach out at journals.sound@gmail.com' +
                  '</div>' +
                '</td>' +
              '</tr>' +
            '</table>' +
          '</td>' +
        '</tr>' +
      '</table>' +
    '</body>' +
    '</html>';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + resendApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'journals. <noreply@mail.journals-studio.com>',
      to: [to],
      subject: 'your downloads are ready \u2014 order #' + orderId,
      html: html,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Resend API error');
  }

  return response.json();
}

/**
 * Retrieve a Stripe checkout session
 */
async function getStripeCheckoutSession(secretKey, sessionId) {
  const response = await fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + sessionId + '?expand[]=line_items',
    {
      headers: {
        'Authorization': 'Bearer ' + secretKey,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to retrieve session');
  }

  return response.json();
}

/**
 * Generate signed download URLs for purchased items
 */
async function generateDownloadLinks(session, env) {
  const downloads = [];
  
  const productDownloads = {
    'price_1SznC60dru4mSFEL0wG8wbYH': {
      name: 'human voice (vol. 1)',
      fileKey: 'samples/human-voice-vol-1.zip',
      size: '~484 MB',
    },
  };

  const purchasedItems = session.metadata?.items 
    ? JSON.parse(session.metadata.items) 
    : [];

  for (const priceId of purchasedItems) {
    const product = productDownloads[priceId];
    if (product) {
      const downloadUrl = await generateSignedUrl(product.fileKey, env, session.id);
      
      downloads.push({
        name: product.name,
        size: product.size,
        url: downloadUrl,
      });
    }
  }

  if (downloads.length === 0 && session.amount_total > 0) {
    downloads.push({
      name: 'human voice (vol. 1)',
      size: '~150 MB',
      url: '/api/download?session=' + session.id + '&file=human-voice-vol-1',
    });
  }

  return downloads;
}

/**
 * Generate a signed download URL
 * Uses HMAC signature to prevent URL tampering
 */
async function generateSignedUrl(fileKey, env, sessionId) {
  const secret = env.DOWNLOAD_SECRET || 'dev-secret-change-me';
  const expires = Date.now() + (24 * 60 * 60 * 1000);
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const data = fileKey + ':' + sessionId + ':' + expires;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const params = new URLSearchParams({
    file: fileKey,
    session: sessionId,
    expires: expires.toString(),
    sig: sig,
  });
  
  return '/api/download?' + params.toString();
}
