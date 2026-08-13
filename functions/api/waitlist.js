/**
 * Waitlist API - Cloudflare Pages Function
 *
 * Captures an email address for upcoming store products (plugins, future
 * sample packs) and notifies journals.sound@gmail.com via Resend.
 *
 * Environment Variables Required:
 * - RESEND_API_KEY
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json().catch(() => ({}));
    const { email, product } = body;

    if (!email) {
      return json({ error: 'Email is required.' }, 400);
    }

    const sanitized = {
      email: String(email).trim().toLowerCase().slice(0, 254),
      product: String(product || 'store').trim().slice(0, 60),
    };

    // Email validation (RFC 5322 simplified)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(sanitized.email)) {
      return json({ error: 'Please provide a valid email address.' }, 400);
    }

    // Light abuse guard: reject obvious throwaway/injection attempts
    // Note: no TLD blocklist. mail.ru and yandex.ru are mainstream consumer
    // providers and CIS is a large electronic-production audience.
    const suspicious = [/<script/i, /javascript:/i];
    if (suspicious.some((p) => p.test(sanitized.email))) {
      return json({ error: 'Please provide a valid email address.' }, 400);
    }

    const resendApiKey = env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured');
      return json(
        { error: 'Signup is not configured. Please email journals.sound@gmail.com' },
        500
      );
    }

    const emailBody = `
New Waitlist Signup
═══════════════════════════════════════

Email: ${sanitized.email}
Interested in: ${sanitized.product}

═══════════════════════════════════════
Submitted: ${new Date().toISOString()}
    `.trim();

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'journals. <onboarding@resend.dev>',
        to: ['journals.sound@gmail.com'],
        reply_to: sanitized.email,
        subject: `📬 Waitlist: ${sanitized.email.replace(/[\r\n]+/g, ' ')}`,
        text: emailBody,
      }),
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error('Resend API error:', resendResponse.status, errorText);
      return json({ error: 'Could not add you right now. Please try again.' }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    console.error('Waitlist error:', err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
