import worker from '../dist/server/index.js';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.searchParams.get('__ss_path');
    if (path !== null) {
      if (!path.startsWith('/') || path.startsWith('//')) return new Response('Invalid route', {status:400});
      url.pathname = path;
      url.searchParams.delete('__ss_path');
    }
    const forwarded = new Request(url, request);
    Object.defineProperty(forwarded, 'cf', {value:{country:request.headers.get('x-vercel-ip-country') || ''}});
    return worker.fetch(forwarded, {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      LEAD_WEBHOOK_URL: process.env.LEAD_WEBHOOK_URL,
      LEAD_WEBHOOK_TOKEN: process.env.LEAD_WEBHOOK_TOKEN,
    });
  },
};
