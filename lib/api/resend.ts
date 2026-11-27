const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  replyTo?: string
}

export interface SendEmailResult {
  id?: string
  error?: string
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) return { error: 'Set RESEND_API_KEY in .env.local to send email.' }
  if (!FROM_EMAIL) return { error: 'Set RESEND_FROM_EMAIL in .env.local to send email.' }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: options.to,
        subject: options.subject,
        html: options.html,
        reply_to: options.replyTo,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[Resend] Error:', err)
      return { error: err }
    }

    // Resend took the email. An answer that can't be read doesn't make it unsent.
    const data = (await res.json().catch(() => null)) as { id?: string } | null
    return { id: data?.id }
  } catch (err) {
    console.error('[Resend] Network error:', err)
    return { error: String(err) }
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** A plain, personal-looking email. Text is escaped — drafts are model-written. */
export function buildOutreachEmailHtml(draft: string, senderName: string): string {
  const paragraphs = draft
    .split(/\n{2,}|\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="margin: 0 0 14px; line-height: 1.6;">${escapeHtml(p)}</p>`)
    .join('')
  const signature = senderName ? `<p style="margin: 18px 0 0;">${escapeHtml(senderName)}</p>` : ''
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a2e; background: #ffffff; margin: 0; padding: 0;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 24px;">${paragraphs}${signature}</div>
</body>
</html>`
}
