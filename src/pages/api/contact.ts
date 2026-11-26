import type { APIRoute } from 'astro'
import { createClient } from '@sanity/client'

export const prerender = false

const sanityClient = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID,
  dataset: import.meta.env.SANITY_DATASET ?? 'production',
  apiVersion: '2026-01-01',
  token: import.meta.env.SANITY_WRITE_TOKEN,
  useCdn: false,
})

// Same limits as the maxlength attributes on the contact form
const LIMITS = { name: 100, email: 254, phone: 30, message: 5000 }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

// Visitor input is placed inside the notification email's HTML. Escaping it
// stops anyone from injecting links or markup into the board's inbox.
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

    const name = field(body.name)
    const email = field(body.email)
    const phone = field(body.phone)
    const message = field(body.message)
    const turnstileToken = field(body.turnstileToken)

    // ── Validate fields ──
    if (!name || !email || !message) {
      return json({ error: 'Name, email and message are required.' }, 400)
    }

    if (
      name.length > LIMITS.name ||
      email.length > LIMITS.email ||
      phone.length > LIMITS.phone ||
      message.length > LIMITS.message
    ) {
      return json({ error: 'One of the fields is too long. Messages can be up to 5,000 characters.' }, 400)
    }

    if (!EMAIL_PATTERN.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400)
    }

    if (!turnstileToken) {
      return json({ error: 'Please complete the human verification.' }, 400)
    }

    // ── Verify Turnstile token ──
    const turnstileRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: import.meta.env.TURNSTILE_SECRET_KEY,
          response: turnstileToken,
        }),
      }
    )
    const turnstileData = await turnstileRes.json()

    if (!turnstileData.success) {
      return json({ error: 'Human verification failed. Please try again.' }, 400)
    }

    // ── Save to Sanity ──
    await sanityClient.create({
      _id: `private.${crypto.randomUUID()}`,
      _type: 'contactSubmission',
      name,
      email,
      phone,
      message,
      submittedAt: new Date().toISOString(),
      status: 'new',
    })

    // ── Send email notification via Resend ──
    const safeName = escapeHtml(name)
    const safeEmail = escapeHtml(email)
    const safePhone = escapeHtml(phone)
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br/>')

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'no-reply@sajjadiamosque.org',
        to: ['info@sajjadiaislamicsociety.org', 'sajjadia786110@gmail.com'],
        // "Reply" in the inbox goes straight to the visitor
        reply_to: email,
        subject: `New contact form submission from ${name.replace(/[\r\n]+/g, ' ')}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${safeName}</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          ${phone ? `<p><strong>Phone:</strong> ${safePhone}</p>` : ''}
          <p><strong>Message:</strong></p>
          <p>${safeMessage}</p>
          <hr/>
          <p style="color:#666;font-size:12px">View all submissions at <a href="https://sajjadia-cms.sanity.studio">sajjadia-cms.sanity.studio</a></p>
        `,
      }),
    })

    if (!resendRes.ok) {
      console.error('Resend error:', await resendRes.text())
    }

    return json({ success: true }, 200)
  } catch (err) {
    console.error('Contact form error:', err)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
}
