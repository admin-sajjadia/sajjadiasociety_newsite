import type { APIRoute } from 'astro'
import { createClient } from '@sanity/client'
import { formatUsPhone, normalizeUsPhone } from '@/lib/usPhone'

export const prerender = false

const sanityClient = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID,
  dataset: import.meta.env.SANITY_DATASET ?? 'production',
  apiVersion: '2026-01-01',
  token: import.meta.env.SANITY_WRITE_TOKEN,
  useCdn: false,
})

// Must match the "connection" options in the subscriber schema in Sanity
const CONNECTIONS: Record<string, string> = {
  'attends': 'Attends Sajjadia programs',
  'family-friend': 'A family member or friend attends',
  'new-to-area': 'New to the area',
  'other': 'Other',
}

const LIMITS = { fullName: 100, city: 60, referredBy: 100, comments: 500 }

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Accepts only strings; anything else becomes an empty string
function field(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// Visitor input goes into the notification email's HTML, so it's escaped
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) ?? {}

    const fullName = field(body.fullName)
    const city = field(body.city)
    const connection = field(body.connection)
    const referredBy = connection === 'family-friend' ? field(body.referredBy) : ''
    const comments = field(body.comments)
    const turnstileToken = field(body.turnstileToken)
    const phoneDigits = normalizeUsPhone(field(body.phone))

    // ── Validate ──
    if (!fullName || !city || !connection || !field(body.phone)) {
      return json({ error: 'Please fill in all required fields.' }, 400)
    }
    if (
      fullName.length > LIMITS.fullName ||
      city.length > LIMITS.city ||
      referredBy.length > LIMITS.referredBy ||
      comments.length > LIMITS.comments ||
      !(connection in CONNECTIONS)
    ) {
      return json({ error: 'Please check the form and try again.' }, 400)
    }
    if (connection === 'other' && !comments) {
      return json({ error: 'Please tell us a little about how you know Sajjadia.' }, 400)
    }
    if (!phoneDigits) {
      return json({ error: 'Please enter a valid US phone number. We can only add US numbers to the group.' }, 400)
    }
    if (!turnstileToken) {
      return json({ error: 'Please complete the verification check.' }, 400)
    }

    // ── Verify the human check ──
    const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: import.meta.env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
      }),
    })
    const turnstileData = await turnstileRes.json()
    if (!turnstileData.success) {
      return json({ error: 'Verification failed. Please try again.' }, 400)
    }

    const phone = formatUsPhone(phoneDigits)

    // ── Skip duplicates ──
    // If this number has asked before (any status, including declined), don't
    // create another request or email. The visitor sees the same success
    // message either way, so the form never reveals what's on file.
    const existing = await sanityClient.fetch<number>(
      'count(*[_type == "subscriber" && phone == $phone])',
      { phone },
      { perspective: 'raw' },
    )
    if (existing > 0) {
      return json({ success: true }, 200)
    }

    // ── Save to Sanity ──
    await sanityClient.create({
      _id: `private.${crypto.randomUUID()}`,
      _type: 'subscriber',
      fullName,
      phone,
      city,
      connection,
      referredBy,
      comments,
      submittedAt: new Date().toISOString(),
      status: 'new',
    })

    // ── Email the board ──
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Sajjadia Website <no-reply@sajjadiamosque.org>',
        to: ['info@sajjadiaislamicsociety.org'],
        subject: `WhatsApp group request: ${fullName.replace(/[\r\n]+/g, ' ')} (${city.replace(/[\r\n]+/g, ' ')})`,
        html: `
          <h2>New WhatsApp Group Request</h2>
          <p><strong>Name:</strong> ${escapeHtml(fullName)}</p>
          <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
          <p><strong>City:</strong> ${escapeHtml(city)}</p>
          <p><strong>How they know Sajjadia:</strong> ${escapeHtml(CONNECTIONS[connection] ?? connection)}</p>
          ${referredBy ? `<p><strong>Knows at Sajjadia:</strong> ${escapeHtml(referredBy)}</p>` : ''}
          ${comments ? `<p><strong>Comments:</strong><br/>${escapeHtml(comments).replace(/\n/g, '<br/>')}</p>` : ''}
          <p>Please review this request before adding anyone to the group.</p>
          <hr/>
          <p style="color:#666;font-size:12px">
            Review it at <a href="https://sajjadia-cms.sanity.studio">sajjadia-cms.sanity.studio</a>
            → WhatsApp Subscribers. Set the status to Approved or Declined, then Added once they're in the group.
          </p>
        `,
      }),
    })

    if (!resendRes.ok) {
      console.error('Resend error:', await resendRes.text())
    }

    return json({ success: true }, 200)
  } catch (err) {
    console.error('Subscribe error:', err)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
}
