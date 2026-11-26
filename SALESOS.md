# SOFT SOLUTIONS SalesOS

The existing Vercel Worker serves the portal at /crm/login and /crm/dashboard. The /crm compatibility entry still supports the original staff workflow. The dashboard uses existing RLS-scoped Supabase queries for day totals, milestone deadlines, follow-ups, booked calls, proposal values and lifetime pipeline counts.

Use the existing Vercel SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY settings. CRM intake continues to use its existing server-side secret. Add staff accounts through Supabase Auth administration. Phase 1 retains the existing staff allowlist. Restricted Sales and Researcher access requires assignment policies across the existing lead and project tables before those roles can enter the workspace.

Build with npm run build and run npm test. Verify /crm/dashboard redirects signed-out visitors, /crm/login serves the sign-in screen, and an existing staff account can see its real records. No demo data is inserted.

Self-service password reset, refresh tokens, and full role management remain pending. Outreach and revenue KPIs require their respective event and payment records.
