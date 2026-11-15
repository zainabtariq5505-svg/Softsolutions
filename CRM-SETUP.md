# SoftSolutions CRM

Private dashboard: `/crm`. Leads enter through the existing contact form. Stages: New, Contacted, Proposal, Won, Lost. Supports search, pagination, notes, follow-up dates, overdue filter, dark/light themes, and dashboard totals. Calendly booking synchronization is not included yet.

## Database

1. In project `jjdawdxoovispaduzzgu`, run `crm-schema.sql` once in the SQL editor.
2. Under Authentication > Users, create your CRM login privately. Use a strong unique password. Disable public signups under Authentication settings for this internal application.
3. Copy that Auth user's UUID; run the membership INSERT shown at the bottom of the SQL file with that UUID. Signing up by itself never grants CRM membership.

## Vercel production environment

Add these to the existing project. Keep both keys in Vercel environment variables, never in GitHub or chat:

- `SUPABASE_URL`: `https://jjdawdxoovispaduzzgu.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY`: the project's publishable key (or legacy anon key).
- `SUPABASE_INTAKE_SECRET`: a random 256-bit server-only intake token. Its SHA-256 hash is pinned in the Supabase crm-inquiry Edge Function. The database master key stays inside Supabase. Rotate the Vercel token and deployed function hash together.

Keep `LEAD_WEBHOOK_URL` to retain Formspree email notifications. If the CRM is configured, the database save must succeed before an inquiry is acknowledged. A mail notification failure after a successful database save does not ask the visitor to resubmit. Existing Formspree submissions are not automatically imported. If no Supabase keys are present, Formspree delivery keeps working and `/crm` displays a configuration message.

Redeploy after environment changes. Sign in at `/crm`. Submit one clearly labeled test inquiry yourself; verify it appears, update its stage and notes, and check the follow-up filter. Verify a signed-out request to `/api/crm/leads` receives 401, and a non-staff login receives 403. Do not use real customer information for tests.

## Access and operation

The browser receives an HttpOnly, Secure, SameSite=Strict session cookie with a maximum one-hour lifetime, never a Supabase secret key. Staff API calls validate the user with Supabase Auth on each request and use their JWT for RLS; removing membership revokes CRM data access. Sessions require signing in again after expiry. Password reset is handled by the project owner in Supabase.

Only explicit `crm_staff` members can view or update leads. Public visitors cannot read or directly insert into the tables. Lead updates permit only stage, notes, and follow-up time. Optimistic concurrency rejects stale updates. No deletion UI is provided.

Before wider rollout, configure managed rate limiting/challenge protection on the public inquiry and login endpoints. Current inquiry protection includes origin checks, bounded payloads, validation, a honeypot, and minimum completion time; these do not replace rate limiting. Set a retention policy and the agency's legal privacy contact before processing live leads. Production database migrations should be backed up and reviewed before future changes.

Validation: `npm run build` then `npm test`. No external messages or live test inquiries are sent by tests.
