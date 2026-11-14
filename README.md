# SOFT SOLUTIONS

Black-and-white agency website with rotating SS monogram, regional pricing, concept portfolio, Calendly booking, and server-side Formspree inquiry handling.

## Local development

Requires Node.js 22. No third-party dependencies.

    npm run build
    npm test
    npm run dev

Open http://localhost:4173.

## Deploy on Vercel

1. Sign in to Vercel and import zainabtariq5505-svg/Softsolutions.
2. Keep the repository root as Root Directory and Framework Preset as Other. The included vercel.json supplies the build command and routing.
3. Under Environment Variables, add LEAD_WEBHOOK_URL with your Formspree endpoint. Enable it for Production and Preview as needed. Optionally add LEAD_WEBHOOK_TOKEN only if your lead provider requires bearer authorization.
4. Deploy. Environment variables from the previous Sites hosting do not transfer automatically.
5. Check /contact shows Send project inquiry, submit a real test inquiry, and verify receipt in Formspree and the destination inbox. Also test Calendly and regional pricing.
6. Add your custom domain in Vercel project settings and apply the DNS records Vercel provides.

If no lead endpoint is configured, the form explicitly offers a downloadable brief instead of pretending to send an inquiry.

## Architecture

api/index.js adapts the existing Web Request/Response handler to Vercel Node.js Functions. vercel.json routes pages, assets, and API paths through it. The build embeds optimized images and front-end assets in dist/server/index.js. The public output folder is intentionally empty; this is a server-rendered application.

Vercel's country header supplies approximate country detection; manual region selection remains persistent. The backend validates origin, required fields, body size, consent, a honeypot, and minimum completion time. No test submissions are sent by the automated tests; delivery is mocked.

## Editable content

src/config.js contains services, packages, regional prices, FAQs, booking URL, and project concepts. Prices remain Request a quote until approved. Concept projects are not client commissions. Live exchange-rate conversion is disabled.

## Launch configuration

Keep credentials in hosting environment variables, never in Git. Confirm your legal entity, business contact, privacy contact and retention policy before commercial launch. Configure suitable public-traffic anti-abuse controls and verify real inquiry delivery. No payments are collected by this website.
