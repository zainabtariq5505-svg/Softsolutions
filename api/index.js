import {isIP} from 'node:net';
import {createGmailSender} from './mail.js';
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
    const candidate=(request.headers.get('x-forwarded-for')||'').split(',')[0].trim();
    const country=request.headers.get('x-vercel-ip-country')||'';
    Object.defineProperty(forwarded,'tracking',{value:process.env.VERCEL==='1'?{ip:isIP(candidate)?candidate:'',country:/^[A-Z]{2}$/.test(country)?country:''}:{ip:'',country:''}});
    return worker.fetch(forwarded, {
      SEND_REMINDER_EMAIL:createGmailSender(process.env),
      CALENDLY_WEBHOOK_SIGNING_KEY:process.env.CALENDLY_WEBHOOK_SIGNING_KEY,
      CALENDLY_ACCESS_TOKEN:process.env.CALENDLY_ACCESS_TOKEN,
      RESEND_API_KEY:process.env.RESEND_API_KEY,
      REMINDER_FROM_EMAIL:process.env.REMINDER_FROM_EMAIL,
      REMINDER_TO_EMAIL:process.env.REMINDER_TO_EMAIL,
      CRON_SECRET:process.env.CRON_SECRET,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_INTAKE_SECRET: process.env.SUPABASE_INTAKE_SECRET,
      LEAD_WEBHOOK_URL: process.env.LEAD_WEBHOOK_URL,
      LEAD_WEBHOOK_TOKEN: process.env.LEAD_WEBHOOK_TOKEN,
    });
  },
};
