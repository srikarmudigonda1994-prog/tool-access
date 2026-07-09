# ROI Report Backend — Setup Guide

This backend receives a name + email address from your calculator page,
generates a PDF report, and emails it to the visitor using **Brevo** — a
free transactional email API that works over regular HTTPS. It also
manages which of the 6 tools are publicly visible, and supports
per-customer access links with tracking and revocation via `admin.html`.

## New: per-customer access links (admin.html)

In addition to the global `ENABLED_TOOLS` setting, you can now create
individual links that unlock specific tools for specific people, without
making them public. This needs a database - see setup below.

### Setup

1. **Sign up free at neon.tech** — a Postgres provider with a genuinely
   permanent free tier (unlike Render's own free Postgres, which is
   deleted after 30 days). No credit card needed.
2. Create a project, copy the connection string it shows you (looks like
   `postgresql://user:password@ep-xxxx.neon.tech/dbname?sslmode=require`)
3. In Render's environment variables, add:
   ```
   DATABASE_URL = your_neon_connection_string
   ADMIN_PASSWORD = pick_a_strong_password
   ```
4. Redeploy — on startup, the backend automatically creates the two
   tables it needs (`customers` and `access_log`). You'll see
   `Database schema ready.` in the logs if it worked.
5. Open `admin.html` on your published site (e.g.
   `https://your-site.netlify.app/admin.html`), log in with the password
   from step 3

### Using it

- **Create a link:** name the customer, check which tool(s) to unlock,
  click Create — you get a link like
  `https://your-site.netlify.app/?access=abc123...`. Send that to them
  however you like (WhatsApp, email).
- **Revoke:** click Revoke next to any customer, instantly cuts off
  their access. Click Restaurar to undo it.
- **Access history:** every time someone opens their link, it's logged
  with a timestamp — visible in the bottom table on the admin page.

### How this differs from the owner preview link

Your `?owner=...` link (a fixed code baked into the page) always shows
all 6 tools and isn't tracked or revocable — it's just for you. Customer
links (`?access=...`) are individually created, tracked, and revocable,
stored in the database, and only unlock the specific tool(s) you chose
for that person - on top of whatever's already public.

## Why Brevo (and not Gmail SMTP or Resend)

- **Gmail SMTP doesn't work on Render's free tier.** Render blocks
  outbound SMTP ports (25, 465, 587) since September 2025 to prevent
  abuse — any SMTP-based sender (Gmail, Outlook, etc.) will fail with a
  connection timeout from a free Render service, regardless of how
  correctly it's configured.
- **Resend's free tier only sends to your own signup email** until you
  verify a domain you own — not useful for real visitors.
- **Brevo's API is plain HTTPS** (not SMTP), so Render's port block
  doesn't apply, and it only requires verifying your sender email by
  clicking a confirmation link — no domain or DNS records needed. You
  can then send to any recipient. Free tier: 300 emails/day.

The owner (you) still gets notified on WhatsApp via CallMeBot directly
from the webpage (`roi-calculator-final.html`), independent of this
backend entirely.

## 1. Set up Brevo (~5 minutes)

1. Sign up free at **brevo.com**
2. Go to **Settings → Senders, Domains & Dedicated IPs → Senders tab**
3. Click **Add a sender**, enter the email address you want to send
   from (can be your own Gmail, a business email, anything you can
   receive mail at)
4. Check that inbox and click the confirmation link Brevo sends
5. Go to **SMTP & API → API Keys → Generate a new API key**
6. Copy the key — you'll only see it once

## 2. Install dependencies

```bash
cd roi-backend
npm install
```

## 3. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env`:
- `BREVO_API_KEY` — the key from step 1
- `BREVO_SENDER_EMAIL` — the email address you verified in step 1
- `ALLOWED_ORIGIN` — set to your published site's URL once live
- `DRY_RUN` — keep as `true` while testing

## 4. Test without sending real emails (DRY_RUN)

```bash
npm start
```

```bash
curl http://localhost:3000/health
```

```bash
curl -X POST http://localhost:3000/api/send-report \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "lang": "es",
    "price": 500000,
    "production": 2000,
    "improvement": 40,
    "unitPrice": 8,
    "hours": 10,
    "extraIncomeMonth": 1920000,
    "months": 0.26,
    "roi3yr": 13724
  }'
```

## 5. Go live

Set `DRY_RUN=false` in `.env` (or your hosting platform's environment
variables), restart, run the same `curl` command with a real email
address you can check — you should receive an email with the PDF
attached within seconds. Unlike the Resend/Gmail attempts, this works
for **any** recipient, not just your own address.

## 6. Deploy it somewhere permanent

Render.com, Railway.app, Fly.io, or a small VPS all work fine — Brevo's
HTTPS API has no port restrictions to worry about on any of them.

Set the same environment variables from `.env` in that platform's
dashboard/secrets manager.

## 7. Point your calculator page at the deployed backend

In `roi-calculator-final.html`, find:
```js
var BACKEND_URL = "http://localhost:3000/api/send-report";
```
Replace with your deployed URL, e.g.:
```js
var BACKEND_URL = "https://your-app.onrender.com/api/send-report";
```

## About the owner WhatsApp notification

This still happens directly from the webpage via CallMeBot — look for
`OWNER_WHATSAPP_NUMBER` and `OWNER_CALLMEBOT_APIKEY` near the top of the
script in `roi-calculator-final.html`. It's independent of this backend;
the visitor's email delivery and the owner's WhatsApp notification can
each succeed or fail without affecting the other.

## Troubleshooting

- **"Missing required environment variables"** — `.env` (or your
  hosting platform's environment variables) isn't fully filled in.
- **"Brevo send failed" with a sender-related message** — the sender
  email hasn't been verified yet (check for the confirmation email and
  click the link), or `BREVO_SENDER_EMAIL` doesn't exactly match the
  address you verified.
- **CORS error in the browser console** — set `ALLOWED_ORIGIN` to match
  the exact origin (protocol + domain) your calculator page is served
  from.
- **Emails landing in spam** — occasional at low volume without a
  verified sending domain; if this becomes a real problem, Brevo also
  supports full domain authentication (SPF/DKIM) later for better
  deliverability, entirely optional at this scale.
