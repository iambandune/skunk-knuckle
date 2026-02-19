/**
 * Intake Form API - Cloudflare Pages Function
 * 
 * Receives intake form submissions, validates them, and sends
 * an email notification via Resend API.
 * Also sends conversion data to Meta via Conversions API.
 * 
 * Environment Variables Required:
 * - RESEND_API_KEY: Your Resend API key (re_...)
 * - META_ACCESS_TOKEN: Your Meta Conversions API access token
 */

// SHA-256 hash helper for Meta CAPI (requires lowercase, trimmed input)
async function hashForMeta(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

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
    const { name, email, phone, service, link, notes, eventId } = body;

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
    const allowedServices = ['stem-master', 'mix-and-master'];
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

    // Map service slugs to display labels
    const serviceLabels = {
      'stem-master': 'Stem Master',
      'mix-and-master': 'Mix + Master',
    };
    const serviceDisplay = serviceLabels[sanitized.service] || sanitized.service;

    // Format the email body
    const emailBody = `
New Intake Form Submission
═══════════════════════════════════════

Name: ${sanitized.name}
Email: ${sanitized.email}
Phone: ${sanitized.phone || '(not provided)'}
Service: ${serviceDisplay}
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
        subject: `🎧 New Intake: ${sanitized.name} — ${serviceDisplay}`,
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

    // ─────────────────────────────────────────────────────────────
    // META CONVERSIONS API (Server-Side Lead Event)
    // ─────────────────────────────────────────────────────────────
    const metaAccessToken = env.META_ACCESS_TOKEN;
    const metaPixelId = '2076925979518264';
    
    if (metaAccessToken) {
      try {
        // Hash user data for privacy (Meta requires SHA-256 lowercase hex)
        const hashedEmail = await hashForMeta(sanitized.email);
        const hashedPhone = sanitized.phone ? await hashForMeta(sanitized.phone.replace(/\D/g, '')) : null;
        const hashedName = await hashForMeta(sanitized.name.split(' ')[0]); // First name only
        
        const eventData = {
          data: [{
            event_name: 'Lead',
            event_time: Math.floor(Date.now() / 1000),
            event_id: eventId || `lead_${Date.now()}`, // For deduplication with browser pixel
            event_source_url: 'https://journals-studio.com/',
            action_source: 'website',
            user_data: {
              em: hashedEmail ? [hashedEmail] : undefined,
              ph: hashedPhone ? [hashedPhone] : undefined,
              fn: hashedName ? [hashedName] : undefined,
              client_user_agent: request.headers.get('user-agent') || undefined,
              client_ip_address: request.headers.get('cf-connecting-ip') || undefined,
            },
            custom_data: {
              content_name: 'Mix & Master Intake',
              content_category: sanitized.service || 'mix-master',
            },
          }],
        };
        
        // Remove undefined values from user_data
        Object.keys(eventData.data[0].user_data).forEach(key => {
          if (eventData.data[0].user_data[key] === undefined) {
            delete eventData.data[0].user_data[key];
          }
        });
        
        const capiResponse = await fetch(
          `https://graph.facebook.com/v18.0/${metaPixelId}/events?access_token=${metaAccessToken}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(eventData),
          }
        );
        
        if (!capiResponse.ok) {
          const capiError = await capiResponse.text();
          console.error('Meta CAPI error:', capiResponse.status, capiError);
        } else {
          console.log('Meta CAPI Lead event sent successfully');
        }
      } catch (capiErr) {
        // Don't fail the request if CAPI fails - just log it
        console.error('Meta CAPI error:', capiErr);
      }
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
