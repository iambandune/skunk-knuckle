/**
 * Stripe Checkout API - Cloudflare Pages Function
 * 
 * Creates a Stripe checkout session for sample pack purchases.
 * 
 * Environment Variables Required:
 * - STRIPE_SECRET_KEY: Your Stripe secret key (sk_test_... or sk_live_...)
 * - SITE_URL: Your site URL for redirects (e.g., https://journals.mp3)
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const { items } = await request.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No items provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build line items for Stripe
    const line_items = items.map(item => ({
      price: item.priceId,
      quantity: item.quantity || 1,
    }));

    // Get the site URL for redirects
    const siteUrl = env.SITE_URL || new URL(request.url).origin;

    // Create Stripe checkout session
    const session = await createStripeCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      line_items,
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/samples`,
      mode: 'payment',
      // Allow promotion codes for discounts
      allow_promotion_codes: true,
      // Collect customer email
      customer_creation: 'always',
      // Metadata for fulfillment
      metadata: {
        source: 'journals-samples',
        items: JSON.stringify(items.map(i => i.priceId)),
      },
    });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Checkout error:', error);
    
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create checkout session' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/**
 * Create a Stripe Checkout Session using the Stripe API directly
 * (No SDK needed - uses fetch)
 */
async function createStripeCheckoutSession({ secretKey, line_items, success_url, cancel_url, mode, allow_promotion_codes, customer_creation, metadata }) {
  const params = new URLSearchParams();
  
  // Add line items
  line_items.forEach((item, index) => {
    params.append(`line_items[${index}][price]`, item.price);
    params.append(`line_items[${index}][quantity]`, item.quantity);
  });

  params.append('mode', mode);
  params.append('success_url', success_url);
  params.append('cancel_url', cancel_url);
  
  if (allow_promotion_codes) {
    params.append('allow_promotion_codes', 'true');
  }
  
  if (customer_creation) {
    params.append('customer_creation', customer_creation);
  }

  // Add metadata
  if (metadata) {
    Object.entries(metadata).forEach(([key, value]) => {
      params.append(`metadata[${key}]`, value);
    });
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Stripe API error');
  }

  return response.json();
}
