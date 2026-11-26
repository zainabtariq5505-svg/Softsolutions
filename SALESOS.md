# SOFT SOLUTIONS SalesOS

The existing Vercel Worker serves the portal at /crm/login and /crm/dashboard. The /crm compatibility entry still supports the original staff workflow. The dashboard uses existing RLS-scoped Supabase queries for day totals, milestone deadlines, follow-ups, booked calls, proposal values and lifetime pipeline counts.

Use the existing Vercel SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY settings. CRM intake continues to use its existing server-side secret. Add staff accounts through Supabase Auth administration. Apply salesos-roles.sql before deploying this version and assign the owner role to the verified existing staff account. The production project has this policy in place. Only Owner and Admin may enter the workspace. Restricted Sales and Researcher access requires assignment policies across the existing lead and project tables before those roles can enter the workspace.

Build with npm run build and run npm test. Verify /crm/dashboard redirects signed-out visitors, /crm/login serves the sign-in screen, and an existing staff account can see its real records. No demo data is inserted.

Full role management remains pending. Outreach and revenue KPIs require their respective event and payment records.

## Sessions, profiles, and recovery

SalesOS uses a server-only Supabase Auth integration with an HttpOnly, Secure, SameSite cookie. Signing in again enables refresh for existing users. Refresh rotates credentials through a same-origin POST and extends the seven-day browser cookie. Logout revokes the local Supabase session and clears that cookie. Supabase access JWTs can remain valid until expiry after revocation. The profile endpoint permits changes to full name only. Email and role are read-only; avatar editing is unavailable.

Allowlist https://www.softsolutions.agency/crm/reset-password under Supabase Authentication URL Configuration. The recovery email template must use Supabase's confirmation URL so the callback receives a PKCE code. Open the recovery email in the same browser that requested it and configure a working Supabase email sender. Test with a designated staff test account before relying on recovery. No new Vercel environment variable is required. The code is exercised with mocked Supabase Auth responses; live email delivery and password changes require an end-to-end check.
