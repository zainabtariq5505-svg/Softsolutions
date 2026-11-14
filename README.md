# SOFT SOLUTIONS

Dependency-free, server-rendered Cloudflare Worker website. Run `npm run build`, `npm test`, and `npm run dev` (localhost:4173).

## Content and commercial setup

- `src/config.js`: regional prices, service packages, FAQs, portfolio concepts, announcement, booking URL, public contact details, socials, and team data.
- Prices are intentionally null until approved. Quote-required messaging is used throughout; no official prices are invented.
- Every supported region has independent Foundation and Growth prices. Manual rates take priority. The price resolver accepts optional rates, but live conversion is disabled pending approval of a rate provider and base prices.
- Approximate region suggestion uses Cloudflare's IP-derived country code, with Rest of World fallback. Manual selection persists in local storage.
- Portfolio projects are original concepts; no client results are claimed.

## Lead integration

Add `LEAD_WEBHOOK_URL` as a hosted runtime secret containing your HTTPS CRM/email-automation endpoint, and optionally `LEAD_WEBHOOK_TOKEN`. The server forwards validated fields as JSON with bearer authorization when configured. Browser code never receives the token. Confirm that the endpoint durably accepts the inquiry and sends notifications. With no endpoint the form downloads a brief and explicitly says it was not sent.

The endpoint validates origin, body size, consent, required fields, honeypot, and minimum completion time. Before exposing to public traffic add provider-level rate limiting and Turnstile or equivalent anti-abuse verification. The initial deployment is private.

## Before commercial launch

Supply final regional prices, booking URL, approved client work, contact information, legal entity and privacy contact, retention terms, and team profiles. Update legal notices for the selected lead processor. Configure and test real inquiry delivery, booking, and anti-abuse controls. Enable an exchange-rate provider only if conversion fallback is desired. No CRM credentials or fabricated contact details are included.
