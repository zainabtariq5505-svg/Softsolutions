# Agency workspace

Open `/crm` and use the existing staff account. All staff routes verify Supabase Auth and `crm_staff` membership; database reads and writes use the staff JWT and RLS.

## Everyday workflow

1. **Today:** new leads since local midnight, overdue follow-ups, active projects, published proposals awaiting a decision, consultation calls, and milestone deadlines. Proposal values stay grouped by currency; they are never added across currencies. Consultation data requires the existing Calendly webhook connection.
2. **Pipeline:** drag cards across New, Contacted, Proposal, Won, Lost. Each card has a native Move to menu for touch and keyboard. Changes use `updated_at` conflict checks and preserve notes. Each column starts with 100 leads and has Load more.
3. **Client workspaces:** create one from a lead via the lead dialog, or search existing leads from Create client workspace. Add a shared summary, target date, milestone acceptance details, HTTPS file links, and shared messages. Private lead notes remain in the inbox. The workspace list is paginated; project details display up to the latest 100 records per section.
4. **Proposals:** add up to 30 line items, quantities, prices, one currency, objectives, expiry date, and written scope/payment terms. Line totals round to two decimals; the total is their sum. Add taxes or extra costs explicitly as line items. Save a draft, review, then Publish to client workspace. Publishing does not email anyone. Published versions are locked; Create revised draft makes an editable copy. Print / Save PDF opens a staff-protected branded document for the browser's print dialog. Publication and client decisions update the linked lead's proposal tracking and activity history.

## Sharing with a client

Create client link inside the project and copy it immediately. The 256-bit random link is shown once; only its SHA-256 hash is stored. Links expire after 30 days and can be revoked individually. Creating another link does not revoke earlier links. Share links manually with the correct recipient; the application does not send them automatically.

The client can see the project's shared summary, milestones, file links, messages, and published proposals. Draft proposals, lead emails, private notes, IP/country/attribution, staff identity, and other projects are excluded. A milestone must be in Review before a client can approve it. A proposal must be published, unexpired, and awaiting a response before a client can accept or decline. Decisions record a self-reported name and timestamp and cannot be replaced by re-submitting. These are project decisions, not verified signatures or payments. Never describe this as identity-verified signing.

Anyone holding a link has access, so keep it private. File links use their external platform's own permissions. Files are linked rather than uploaded into Supabase. Revoke links when a project closes. Client links remain in the URL fragment, which is not included in HTTP requests; the portal sets no-referrer and stores no token in local storage. Refresh checks current expiry/revocation. The portal refreshes every 30 seconds while visible.

## Implementation

- `crm-studio.sql`: additive schema, staff policies and column grants, service-only bounded `crm_portal` RPC, exact Today aggregate, and Realtime publication.
- `crm-studio-proposal-sync.sql`: bounds totals and synchronizes published proposal status/value into lead tracking using a transaction-scoped invoker trigger.
- `src/studio-server.js`: staff CRUD, conflict checks, proposal validation and print view, hashing for client capabilities, public portal boundary.
- `src/studio-client.js`, `studio.css`: staff UI; concatenated into the existing CRM bundle by `build.mjs`.
- `src/portal.*`: empty public portal shell; shared data arrives only after a valid token check. No arbitrary RPC or table path is accepted.
- `supabase/functions/crm-inquiry/index.ts`: existing private API-key boundary; added only a `portal` operation that calls service-only `crm_portal`. Master key remains in Supabase Edge secrets.

Supabase Realtime invalidates staff views; periodic refresh provides fallback. Unsaved project/proposal fields are preserved. Staff sessions keep the existing one-hour expiry. Gmail App Password and Calendly webhook authorization remain separate setup requirements; no email was sent during testing.

## Validation

`npm run build && npm test` includes authorization, origins, stage conflicts, token hashing, proposal amount limits/publication, escaping in print views, and the three service pages. Transactional database checks verify portal isolation, milestone approval, immutable decisions, revocation, RLS, locked published proposals, editable drafts, publication-to-lead sync, and exact Today totals. Synthetic fixtures are rolled back. Local browser QA uses synthetic data only; it does not seed production leads.
