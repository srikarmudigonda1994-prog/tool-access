/**
 * Sends the PDF report via Brevo's transactional email API (HTTPS, not
 * SMTP) - this matters because Render's free tier blocks outbound SMTP
 * ports (25, 465, 587), which is why Gmail SMTP failed with a connection
 * timeout. Brevo's API works over regular HTTPS, so that block doesn't
 * apply, and unlike Resend, Brevo only requires you to verify your
 * sender address by clicking a link in your own email - no domain or
 * DNS records needed - after which you can send to any recipient.
 *
 * Docs: https://developers.brevo.com/docs/send-a-transactional-email
 *
 * Setup (~5 minutes, see README.md for the full walkthrough):
 *   1. Sign up free at brevo.com
 *   2. Add/verify a sender: Settings > Senders, Domains & Dedicated IPs
 *      > Senders tab > Add a sender > enter your email > click the
 *      confirmation link Brevo emails you. No domain needed.
 *   3. Create an API key: SMTP & API > API Keys > Generate a new API key
 *   4. Put both in .env:
 *        BREVO_API_KEY=your_api_key
 *        BREVO_SENDER_EMAIL=the_email_you_verified
 *
 * Required environment variables:
 *   BREVO_API_KEY
 *   BREVO_SENDER_EMAIL
 */

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function assertEnv() {
  const required = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

const COPY = {
  es: {
    greetingWithName: (name) => `Hola ${name},`,
    greetingNoName: 'Hola,',
    body: 'Adjunto encontrarás tu análisis personalizado en PDF.',
    signoff: 'Saludos,<br>Equipo Profill.mx',
  },
  en: {
    greetingWithName: (name) => `Hi ${name},`,
    greetingNoName: 'Hi,',
    body: 'Attached is your personalized analysis as a PDF.',
    signoff: 'Best,<br>The Profill.mx Team',
  },
};

/**
 * Sends the PDF report to the given email address.
 * @param {Object} opts
 * @param {string} opts.toEmail
 * @param {string} opts.name
 * @param {string} opts.lang        'es' | 'en'
 * @param {Buffer} opts.pdfBuffer
 * @param {string} [opts.subject]   defaults to a generic subject if omitted
 * @param {string} [opts.filename]  defaults to 'reporte.pdf' if omitted
 */
async function sendReportEmail({ toEmail, name, lang, pdfBuffer, subject, filename }) {
  assertEnv();
  const t = COPY[lang] || COPY.es;
  const greeting = name ? t.greetingWithName(name) : t.greetingNoName;
  const defaultSubject = lang === 'en' ? 'Your report — Profill.mx' : 'Tu reporte — Profill.mx';

  const html = `
    <p>${greeting}</p>
    <p>${t.body}</p>
    <p>${t.signoff}</p>
  `;

  const payload = {
    sender: { email: process.env.BREVO_SENDER_EMAIL, name: 'Profill.mx' },
    to: [{ email: toEmail }],
    subject: subject || defaultSubject,
    htmlContent: html,
    attachment: [
      {
        name: filename || 'reporte.pdf',
        content: pdfBuffer.toString('base64'),
      },
    ],
  };

  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Brevo send failed: ${JSON.stringify(json)}`);
  }
  return json;
}

module.exports = { sendReportEmail };
