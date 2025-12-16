/**
 * Test Download API - FOR DEVELOPMENT ONLY
 * 
 * Allows testing the R2 download without going through Stripe.
 * DELETE THIS FILE before going to production!
 */

export async function onRequestGet(context) {
  const { env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    // Check if R2 bucket is bound
    if (!env.SAMPLES_BUCKET) {
      return new Response(
        JSON.stringify({ 
          error: 'R2 bucket not configured',
          help: 'Add SAMPLES_BUCKET binding in Cloudflare Pages settings'
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Try to get the test file
    const fileKey = 'human-voice-vol-1.zip';
    const object = await env.SAMPLES_BUCKET.get(fileKey);

    if (!object) {
      return new Response(
        JSON.stringify({ 
          error: 'File not found in R2',
          fileKey,
          help: 'Upload the file with: wrangler r2 object put journals-samples/human-voice-vol-1.zip --file=path/to/file.zip --remote'
        }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Success! Return the file
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileKey}"`,
        'Content-Length': object.size,
        'Cache-Control': 'private, no-cache',
      },
    });

  } catch (error) {
    console.error('Test download error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
