/**
 * Intake Form API - Cloudflare Pages Function
 * 
 * Receives intake form submissions, validates them, and sends
 * an email notification via Resend API.
 * 
 * Environment Variables Required:
 * - RESEND_API_KEY: Your Resend API key (re_...)
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
    const body = await request.json();
    const { name, email, phone, service, link, notes } = body;

    // ─────────────────────────────────────────────────────────────
    // VALIDATION
    // ─────────────────────────────────────────────────────────────

    // Required fields check
    if (!name || !email || !service || !link) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: name, email, service, and link are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sanitize inputs (trim whitespace)
    const sanitized = {
      name: String(name).trim().slice(0, 200),
      email: String(email).trim().toLowerCase().slice(0, 254),
      phone: String(phone || '').trim().slice(0, 30),
      service: String(service).trim().slice(0, 50),
      link: String(link).trim().slice(0, 2000),
      notes: String(notes || '').trim().slice(0, 5000),
    };

    // Email validation (RFC 5322 simplified)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitized.email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email address format.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Additional email validation - check for common typos
    const suspiciousEmailPatterns = [
      /\.con$/i,  // .con instead of .com
      /\.cmo$/i,  // .cmo instead of .com
      /\.ocm$/i,  // .ocm instead of .com
      /@gmial\./i, // gmial instead of gmail
      /@gamil\./i, // gamil instead of gmail
      /@gmai\./i,  // gmai instead of gmail
    ];
    const hasSuspiciousEmail = suspiciousEmailPatterns.some(p => p.test(sanitized.email));
    if (hasSuspiciousEmail) {
      return new Response(
        JSON.stringify({ error: 'Please double-check your email address for typos.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // URL validation for streaming link
    let parsedUrl;
    try {
      // Prepend https:// if no protocol specified
      let urlToValidate = sanitized.link;
      if (!/^https?:\/\//i.test(urlToValidate)) {
        urlToValidate = 'https://' + urlToValidate;
      }
      parsedUrl = new URL(urlToValidate);
      
      // Must be http or https
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return new Response(
        JSON.stringify({ error: 'Please provide a valid URL for your streaming link.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Basic URL security checks
    const blockedPatterns = [
      /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i,  // Local/private IPs
      /\.(exe|bat|cmd|sh|ps1|msi|dll|scr)$/i,  // Executable file extensions
      /<script|javascript:|data:/i,  // Script injection attempts
    ];
    const urlString = parsedUrl.href;
    const isBlocked = blockedPatterns.some(p => p.test(parsedUrl.hostname) || p.test(urlString));
    if (isBlocked) {
      return new Response(
        JSON.stringify({ error: 'This URL type is not allowed. Please provide a link to Spotify, SoundCloud, Google Drive, Dropbox, etc.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Service must be one of the allowed values
    const allowedServices = ['mix', 'master', 'both'];
    if (!allowedServices.includes(sanitized.service)) {
      return new Response(
        JSON.stringify({ error: 'Invalid service selection.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─────────────────────────────────────────────────────────────
    // SEND EMAIL VIA RESEND
    // ─────────────────────────────────────────────────────────────

    const resendApiKey = env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Email service not configured. Please contact us directly at journals.sound@gmail.com' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format the email body
    const emailBody = `
New Intake Form Submission
═══════════════════════════════════════

Name: ${sanitized.name}
Email: ${sanitized.email}
Phone: ${sanitized.phone || '(not provided)'}
Service: ${sanitized.service}
Streaming Link: ${parsedUrl.href}

Notes:
${sanitized.notes || '(none)'}

═══════════════════════════════════════
Submitted: ${new Date().toISOString()}
    `.trim();

    // Send via Resend API
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'journals. intake <onboarding@resend.dev>', // Use your verified domain later
        to: ['journals.sound@gmail.com'],
        reply_to: sanitized.email,
        subject: `🎧 New Intake: ${sanitized.name} — ${sanitized.service}`,
        text: emailBody,
      }),
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error('Resend API error:', resendResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to send notification. Please try again or contact us directly.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Success!
    return new Response(
      JSON.stringify({ success: true, message: 'Intake received successfully!' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Intake error:', err);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// Handle preflight requests
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
