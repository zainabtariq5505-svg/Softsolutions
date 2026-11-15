# CRM tracking and integrations

## Available in the workspace

- Source attribution: landing path, referral hostname, UTM source/medium/campaign. The browser keeps first-touch attribution for its current tab session; these values describe submitted attribution, not independently verified ad conversions.
- Visitor IP and approximate country: read only from Vercel-provided request headers. Selected pricing region is a separate field. IPs are removed after 30 days by the daily maintenance job. Existing leads and Calendly webhooks may have no IP/country. No reverse lookup service receives the visitor IP.
- Country names and locally served SVG flags from flag-icons (license in assets/flags/LICENSE).
- Live updates: an authenticated server-sent event stream bridges Supabase Realtime using the staff user's token. Tokens remain server-side. Streams reconnect every 22 seconds to fit serverless execution; changes trigger fresh authorized queries. A 30-second refresh catches missed events. Unsaved form edits are preserved, and stale saves are rejected.
- Immutable activity history for lead creation, stage changes, note edits, follow-up changes, proposals, and consultations. Historical edits before this release cannot be reconstructed.
- Follow-ups due or coming within 24 hours, plus proposal title, amount, currency, status, and HTTPS link. Tracking a proposal does not email it to the lead.

## Gmail reminders

Production Vercel variables:

- `GMAIL_SMTP_USER`: Gmail/Workspace address used to send.
- `GMAIL_SMTP_APP_PASSWORD`: Google-generated 16-character App Password, stored as a Vercel Secret. Never use an ordinary Google password, commit this value, or put it in chat.
- `REMINDER_TO_EMAIL`: the agency inbox receiving reminders.
- `CRON_SECRET`: generated random job secret, stored only in Vercel.

Google requires 2-Step Verification for App Passwords; some accounts cannot use them. Generate the password privately at https://myaccount.google.com/apppasswords and add it directly in Vercel. If unavailable, use OAuth or a transactional provider instead.

The daily job runs at 04:00 UTC (09:00 Pakistan time). It removes expired IPs and sends up to five due follow-up reminders per run. Staff can send another batch with **Send due email reminders**. In-app follow-up alerts update while the workspace is open; emails are not minute-by-minute notifications.

The queue uses a unique lead/date key, row locks, leases, and bounded retries. Gmail uses stable Message-IDs, but SMTP cannot guarantee exactly-once delivery if the provider accepts mail immediately before a process failure. Review delivery failures before retrying. Resend is also supported through `RESEND_API_KEY` and `REMINDER_FROM_EMAIL`, with provider idempotency keys.

Mail goes only to the configured agency inbox. No follow-up email is sent to a lead. Missing sender credentials are shown as setup required; configuration alone does not verify actual delivery.

## Calendly consultation capture

Public scheduling link: https://calendly.com/softsolutionsagencypk/30min

Webhook endpoint: `https://www.softsolutions.agency/api/webhooks/calendly`

Subscribe to `invitee.created` and `invitee.canceled` for the correct Calendly user/organization. This requires an authorized Calendly account with webhook access. Set the subscription's signing key as Vercel Secret `CALENDLY_WEBHOOK_SIGNING_KEY`. Optionally set `CALENDLY_ACCESS_TOKEN` to resolve meeting details if the webhook only supplies an event URI. Keep credentials out of source and chat.

Signatures are checked against the exact raw request body with a five-minute timestamp tolerance. Repeated deliveries are idempotent. Cancellation is retained if an older create event arrives afterward. Bookings match an existing lead by email or create a new consultation lead, and appear in its activity timeline. Unknown meeting times stay unknown; no visitor IP/country is invented for bookings.

Until the signed subscription is configured, booking sync is not active. Changing the public scheduling URL alone does not create a webhook subscription.

## Verification

`npm run build && npm test` checks website/Vercel behavior, access boundaries, origin protection, webhook signatures and replay rejection, source attribution, proposal validation, job authentication, the reminder queue adapter, and Gmail transport behavior. Tests use synthetic data and do not send email. Database integration checks run in rolled-back transactions.

After enabling Gmail and Calendly, run a real approved reminder delivery and a consultation booking/cancellation test. Confirm provider delivery, the live workspace, and its activity timeline.
