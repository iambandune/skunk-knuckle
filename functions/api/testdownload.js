export async function onRequestGet(context) {
  const { env } = context;

  return new Response(
    JSON.stringify({ 
      message: 'Test endpoint working!',
      hasBucket: !!env.SAMPLES_BUCKET,
      timestamp: new Date().toISOString()
    }),
    { 
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}
// force rebuild Mon Dec 15 22:21:03 CST 2025
