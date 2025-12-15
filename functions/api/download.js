/**
 * Download API - Cloudflare Pages Function
 * 
 * Serves sample pack downloads with signed URL verification.
 * 
 * Environment Variables Required:
 * - DOWNLOAD_SECRET: Secret for verifying signed URLs
 * - R2_BUCKET: (optional) R2 bucket binding for file storage
 */

export async function onRequestGet(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const url = new URL(request.url);
    const file = url.searchParams.get('file');
    const sessionId = url.searchParams.get('session');
    const expires = url.searchParams.get('expires');
    const signature = url.searchParams.get('sig');

    // Validate required params
    if (!file || !sessionId || !expires || !signature) {
      return new Response(
        JSON.stringify({ error: 'Invalid download link' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check expiration
    if (Date.now() > parseInt(expires)) {
      return new Response(
        JSON.stringify({ error: 'Download link expired. Please check your email for a new link.' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify signature
    const isValid = await verifySignature(file, sessionId, expires, signature, env);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid download link' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Serve the file
    // Option 1: From R2 bucket (recommended for production)
    if (env.SAMPLES_BUCKET) {
      const object = await env.SAMPLES_BUCKET.get(file);
      
      if (!object) {
        return new Response(
          JSON.stringify({ error: 'File not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get filename from path
      const filename = file.split('/').pop();
      
      return new Response(object.body, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': object.size,
          'Cache-Control': 'private, no-cache',
        },
      });
    }

    // Option 2: Redirect to external storage URL (if using external CDN)
    // const externalUrl = `https://your-cdn.com/${file}?token=...`;
    // return Response.redirect(externalUrl, 302);

    // Option 3: Placeholder response (for development)
    return new Response(
      JSON.stringify({ 
        message: 'Download system ready. R2 bucket not configured yet.',
        file,
        sessionId,
        instructions: 'Set up SAMPLES_BUCKET R2 binding to enable downloads.'
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Download error:', error);
    
    return new Response(
      JSON.stringify({ error: 'Download failed. Please try again or contact support.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Verify the HMAC signature of the download URL
 */
async function verifySignature(file, sessionId, expires, providedSig, env) {
  const secret = env.DOWNLOAD_SECRET || 'dev-secret-change-me';
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const data = `${file}:${sessionId}:${expires}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  return expectedSig === providedSig;
}
