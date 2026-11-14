import {render} from './render.js';
import {regions} from './config.js';
import styles from './styles-text.js';
import client from './client-text.js';
import configuration from './config-text.js';
import imageAssets from './assets-text.js';
const euro=new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);
export function countryRegion(country){return regions[country]?country:euro.has(country)?'EU':'ROW';}
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'self' https://*.chatgpt.com https://chatgpt.com; form-action 'self'"};
function response(body,type='application/json',status=200){return new Response(type==='application/json'?JSON.stringify(body):body,{status,headers:{...headers,'Content-Type':type+'; charset=utf-8'}})}
export default {async fetch(request,env={}){const url=new URL(request.url);const path=url.pathname.replace(/\/$/,'')||'/';if(path==='/api/region')return response({region:countryRegion(request.cf?.country||'')});if(path==='/api/status')return response({inquiries:Boolean(env.LEAD_WEBHOOK_URL)});if(path==='/api/inquiry'){
if(request.method!=='POST')return response({error:'Method not allowed'},'application/json',405);
if(request.headers.get('origin')!==url.origin)return response({error:'Invalid origin'},'application/json',403);
if(!env.LEAD_WEBHOOK_URL)return response({error:'Inquiry delivery is not configured. Please download your project brief instead.'},'application/json',503);
if(Number(request.headers.get('content-length'))>16000)return response({error:'Inquiry too large'},'application/json',413);
let d;try{const body=await request.text();if(body.length>16000)throw Error();d=JSON.parse(body)}catch{return response({error:'Invalid request'},'application/json',400)}
if(d.fax||!(Number(d.elapsed)>=3000)||!d.consent||!regions[d.region]||typeof d.name!=='string'||!d.name.trim()||d.name.length>100||typeof d.email!=='string'||!/^\S+@\S+\.\S+$/.test(d.email)||d.email.length>200||typeof d.description!=='string'||d.description.trim().length<20||d.description.length>5000)return response({error:'Please check your required fields and try again.'},'application/json',400);
try{const endpoint=new URL(env.LEAD_WEBHOOK_URL);if(endpoint.protocol!=='https:')throw Error();const clean=Object.fromEntries(['name','email','company','website','region','service','budget','description'].map(k=>[k,String(d[k]||'').slice(0,k==='description'?5000:500)]));const result=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json',...(env.LEAD_WEBHOOK_TOKEN?{Authorization:'Bearer '+env.LEAD_WEBHOOK_TOKEN}:{})},body:JSON.stringify({...clean,message:clean.description,_subject:'SOFT SOLUTIONS — New project inquiry',source:'soft-solutions',submittedAt:new Date().toISOString()}),signal:AbortSignal.timeout(10000)});if(!result.ok)throw Error();return response({ok:true})}catch{return response({error:'Your inquiry could not be delivered. Please try again later.'},'application/json',502)}}
if(request.method!=='GET'&&request.method!=='HEAD')return response({error:'Method not allowed'},'application/json',405);
if(imageAssets[path]){const bytes=Uint8Array.from(atob(imageAssets[path]),c=>c.charCodeAt(0));return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers,'Content-Type':'image/webp','Cache-Control':'public, max-age=86400'}});}
if(path==='/styles.css')return response(styles,'text/css');if(path==='/client.js')return response(client,'text/javascript');if(path==='/config.js')return response(configuration,'text/javascript');if(path==='/robots.txt')return response('User-agent: *\nAllow: /\n','text/plain');const result=render(path,Boolean(env.LEAD_WEBHOOK_URL));const r=response(result.html,'text/html',result.title==='Page not found'?404:200);if(request.method==='HEAD')return new Response(null,{status:r.status,headers:r.headers});return r;}};

