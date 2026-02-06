/**
 * Verify Session API - Cloudflare Pages Function
 * 
 * Verifies a Stripe checkout session and returns download links.
 * 
 * Environment Variables Required:
 * - STRIPE_SECRET_KEY: Your Stripe secret key
 * - R2_BUCKET: (optional) R2 bucket binding for file storage
 * - DOWNLOAD_SECRET: Secret for signing download URLs
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
    const downloads = await generateDownloadLinks(session, env);

    return new Response(
      JSON.stringify({
        success: true,
        orderId: session.id.slice(-8).toUpperCase(),
        email: session.customer_details?.email || session.customer_email,
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
 * Retrieve a Stripe checkout session
 */
async function getStripeCheckoutSession(secretKey, sessionId) {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items`,
    {
      headers: {
        'Authorization': `Bearer ${secretKey}`,
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
  
  // Map of Stripe price IDs to download info
  // TODO: Move this to a database or KV store in production
  const productDownloads = {
    'price_1Sxj250dru4mSFELaaA5gkTb': {
      name: 'human voice (vol. 1)',
      // R2 object key or direct URL
      fileKey: 'samples/human-voice-vol-1.zip',
      size: '~484 MB',
    },
    // Add more products as needed
  };

  // Get purchased items from session metadata or line items
  const purchasedItems = session.metadata?.items 
    ? JSON.parse(session.metadata.items) 
    : [];

  for (const priceId of purchasedItems) {
    const product = productDownloads[priceId];
    if (product) {
      // Generate a signed download URL
      const downloadUrl = await generateSignedUrl(product.fileKey, env, session.id);
      
      downloads.push({
        name: product.name,
        size: product.size,
        url: downloadUrl,
      });
    }
  }

  // Fallback: if no specific items found, return a generic download
  if (downloads.length === 0 && session.amount_total > 0) {
    downloads.push({
      name: 'human voice (vol. 1)',
      size: '~150 MB',
      // This will be a placeholder until R2 is set up
      url: `/api/download?session=${session.id}&file=human-voice-vol-1`,
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
  const expires = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
  
  // Create signature
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const data = `${fileKey}:${sessionId}:${expires}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  // Build download URL
  const params = new URLSearchParams({
    file: fileKey,
    session: sessionId,
    expires: expires.toString(),
    sig,
  });
  
  return `/api/download?${params.toString()}`;
}
