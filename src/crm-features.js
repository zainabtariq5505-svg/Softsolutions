const crmProposalStates=['draft','sent','accepted','declined'];
function crmConstantEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0;}
async function crmBoundedBody(request,max=65536){const reader=request.body?.getReader();if(!reader)throw Error('Missing body');let length=0,parts=[];while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();throw Error('Too large');}parts.push(value);}const body=new Uint8Array(length);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.byteLength;}return new TextDecoder().decode(body);}
function crmAttribution(request,d){const a=d.attribution&&typeof d.attribution==='object'?d.attribution:{};const clean=v=>String(v||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,100);let referrer='';try{const u=new URL(a.referrer||'');if(['https:','http:'].includes(u.protocol))referrer=u.hostname.slice(0,200);}catch{}let landing='';try{const u=new URL(a.landing_path||'',new URL(request.url).origin);if(u.origin===new URL(request.url).origin)landing=u.pathname.slice(0,200);}catch{}return {ip:request.tracking?.ip||'',country:request.tracking?.country||'',referrer_host:referrer,landing_path:landing,utm_source:clean(a.utm_source),utm_medium:clean(a.utm_medium),utm_campaign:clean(a.utm_campaign)};}
async function crmIntakeOperation(env,operation,payload={}){const result=await crmSupabase(env,'/functions/v1/crm-inquiry',{method:'POST',headers:{'x-crm-intake-key':env.SUPABASE_INTAKE_SECRET},body:JSON.stringify({operation,...payload})});if(!result.ok)throw Error('Integration request failed');return result.json();}
async function crmCalendlyWebhook(request,env){
 if(request.method!=='POST')return crmReply({error:'Method not allowed'},405);
 if(!env.CALENDLY_WEBHOOK_SIGNING_KEY||!crmIntakeReady(env))return crmReply({error:'Calendly booking sync is not configured.'},503);
 const signature=request.headers.get('calendly-webhook-signature')||'';
 const tokens=signature.split(',').map(p=>p.trim().split('='));const timestamp=tokens.find(p=>p[0]==='t')?.[1];const signatures=tokens.filter(p=>p[0]==='v1').map(p=>p[1]);
 if(!/^\d+$/.test(timestamp||'')||Math.abs(Date.now()/1000-Number(timestamp))>300)return crmReply({error:'Invalid webhook signature'},401);
 let body;try{body=await crmBoundedBody(request);}catch{return crmReply({error:'Invalid webhook body'},400);}
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.CALENDLY_WEBHOOK_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+body));const expected=Array.from(new Uint8Array(signed)).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(!signatures.some(s=>crmConstantEqual(s,expected)))return crmReply({error:'Invalid webhook signature'},401);
 let data;try{data=JSON.parse(body);}catch{return crmReply({error:'Invalid JSON'},400);}
 if(!['invitee.created','invitee.canceled'].includes(data.event))return crmReply({ok:true,ignored:true});
 const p=data.payload||{};const safeURI=v=>typeof v==='string'&&/^https:\/\/api\.calendly\.com\/[a-zA-Z0-9_\/-]+$/.test(v)?v:null;
 const invitee=safeURI(p.uri),event=safeURI(typeof p.event==='string'?p.event:p.scheduled_event?.uri);
 if(!invitee||!event||typeof p.email!=='string'||p.email.length>200||!/^\S+@\S+\.\S+$/.test(p.email))return crmReply({error:'Invalid booking data'},400);
 let scheduled=p.scheduled_event||{};
 if(!scheduled.start_time&&env.CALENDLY_ACCESS_TOKEN){const result=await fetch(event,{headers:{Authorization:'Bearer '+env.CALENDLY_ACCESS_TOKEN},signal:AbortSignal.timeout(8000)});if(!result.ok)return crmReply({error:'Unable to read consultation time'},502);scheduled=(await result.json()).resource||{};}
 const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
 try{await crmIntakeOperation(env,'calendly',{booking:{invitee_uri:invitee,event_uri:event,email:p.email.toLowerCase(),name:String(p.name||'Consultation guest').slice(0,100),status:data.event==='invitee.canceled'?'canceled':'active',starts_at:time(scheduled.start_time),ends_at:time(scheduled.end_time),event_name:String(scheduled.name||'Consultation').slice(0,200)}});return crmReply({ok:true});}catch{return crmReply({error:'Booking could not be saved. Retry delivery.'},502);}
}
function crmEmailReady(env){return Boolean(env.REMINDER_TO_EMAIL&&(typeof env.SEND_REMINDER_EMAIL==='function'||(env.RESEND_API_KEY&&env.REMINDER_FROM_EMAIL)));}
async function crmSendReminders(env){
 if(!crmIntakeReady(env))return crmReply({error:'CRM intake is not configured.'},503);
 await crmIntakeOperation(env,'maintenance');
 if(!crmEmailReady(env))return crmReply({error:'Email reminders require a verified sender and email delivery configuration.'},503);
 const from=env.REMINDER_FROM_EMAIL||'',to=env.REMINDER_TO_EMAIL;
 if(/[\r\n]/.test(from+to)||!/^\S+@\S+\.\S+$/.test(to))return crmReply({error:'Invalid reminder email configuration'},503);
 const claimed=await crmIntakeOperation(env,'reminders.claim');const rows=Array.isArray(claimed.data)?claimed.data:[];let sent=0,failed=0;
 // One batch is bounded so a serverless request cannot send an unbounded number of emails.
 for(const row of rows){let ok=false,id=null;try{const subject='SoftSolutions — follow-up due';const text='Follow-up due for '+String(row.name).slice(0,100)+'\nScheduled: '+new Date(row.scheduled_for).toISOString()+'\n\nOpen your private CRM: https://www.softsolutions.agency/crm\nLead reference: '+row.lead_id+'\n\nThis reminder is for the agency team. No message was sent to the lead.';
 if(typeof env.SEND_REMINDER_EMAIL==='function'){id=(await env.SEND_REMINDER_EMAIL({to,subject,text,reminderId:row.id})).id;ok=typeof id==='string';}
 else {const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'crm-follow-up/'+row.id},body:JSON.stringify({from,to:[to],subject,text}),signal:AbortSignal.timeout(5000)});if(result.ok){id=(await result.json()).id;ok=typeof id==='string';}}}catch{}
  await crmIntakeOperation(env,'reminders.finish',{reminder_id:row.id,was_sent:ok,provider_id:id});if(ok)sent++;else failed++;
  await new Promise(resolve=>setTimeout(resolve,600));
 }
 return crmReply({ok:true,sent,failed});
}
async function crmReminderJob(request,env){if(request.method!=='GET')return crmReply({error:'Method not allowed'},405);const auth=request.headers.get('authorization')||'';if(!env.CRON_SECRET||!crmConstantEqual(auth,'Bearer '+env.CRON_SECRET))return crmReply({error:'Unauthorized'},401);try{if(!crmEmailReady(env)){await crmIntakeOperation(env,'maintenance');return crmReply({ok:true,email_enabled:false,sent:0});}return await crmSendReminders(env);}catch{return crmReply({error:'Reminder processing failed. Pending reminders will be retried.'},502);}}
function crmRealtimeStream(request,env,token){
 if(typeof WebSocket!=='function')return crmReply({error:'Live updates are temporarily unavailable'},503);
 const url=new URL(env.SUPABASE_URL);url.protocol='wss:';url.pathname='/realtime/v1/websocket';url.search='';url.searchParams.set('apikey',env.SUPABASE_PUBLISHABLE_KEY);url.searchParams.set('vsn','1.0.0');
 const socket=new WebSocket(url);let stop,heartbeat,lifetime,closed=false;
 const stream=new ReadableStream({start(controller){const encoder=new TextEncoder();const emit=(event,data)=>{if(!closed)try{controller.enqueue(encoder.encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));}catch{stop();}};
 stop=()=>{if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(lifetime);request.signal.removeEventListener('abort',stop);try{socket.close();}catch{}try{controller.close();}catch{}};
 emit('connecting',{});
 socket.addEventListener('open',()=>{socket.send(JSON.stringify({topic:'realtime:crm-workspace',event:'phx_join',payload:{config:{broadcast:{ack:false,self:false},presence:{enabled:false},postgres_changes:['crm_leads','crm_activity','crm_bookings','crm_projects','crm_milestones','crm_resources','crm_messages','crm_proposals'].map(table=>({event:'*',schema:'public',table}))},access_token:token},ref:'1',join_ref:'1'}));heartbeat=setInterval(()=>{if(socket.readyState===1)socket.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(Date.now())}));},10000);});
  socket.addEventListener('message',e=>{let m;try{m=JSON.parse(String(e.data));}catch{return;}if(m.event==='phx_reply'&&m.ref==='1'){if(m.payload?.status==='ok')emit('ready',{});else{emit('unavailable',{});stop();}}if(m.event==='system'&&m.payload?.status==='error'){emit('unavailable',{});stop();}if(m.event==='postgres_changes')emit('change',{});});
 socket.addEventListener('error',()=>{emit('unavailable',{});stop();});socket.addEventListener('close',()=>stop());
 lifetime=setTimeout(stop,22000);request.signal.addEventListener('abort',stop,{once:true});if(request.signal.aborted)stop();
 },cancel(){stop?.();}});
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'private, no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}
async function crmFeatureRoute(request,env,path,token){
 if(path==='/api/crm/events'&&request.method==='GET')return crmRealtimeStream(request,env,token);
 if(path==='/api/crm/integrations'&&request.method==='GET')return crmReply({calendly:Boolean(env.CALENDLY_WEBHOOK_SIGNING_KEY),email:crmEmailReady(env),email_schedule:'Daily at 09:00 Pakistan time (04:00 UTC); send due reminders manually at any time.',ip_retention_days:30});
 if(path==='/api/crm/reminders/send'&&request.method==='POST')return crmSendReminders(env);
 if(/^\/api\/crm\/leads\/[a-f0-9-]{36}$/.test(path)&&request.method==='GET'){const query=new URLSearchParams({select:'*',id:'eq.'+path.split('/').pop(),limit:'1'});const result=await crmSupabase(env,'/rest/v1/crm_leads?'+query,{},token);if(!result.ok)return crmReply({error:'Unable to load lead'},502);const rows=await result.json();return rows.length?crmReply({lead:rows[0]}):crmReply({error:'Lead not found'},404);}
 if(path==='/api/crm/reminders'&&request.method==='GET'){
  const end=new Date(Date.now()+86400000).toISOString();const q=new URLSearchParams({select:'id,name,follow_up_at,stage',stage:'not.in.(won,lost)',follow_up_at:'lte.'+end,order:'follow_up_at.asc',limit:'50'});
  const result=await crmSupabase(env,'/rest/v1/crm_leads?'+q,{},token);if(!result.ok)return crmReply({error:'Unable to load follow-ups'},502);return crmReply({reminders:await result.json()});
 }
 if(/^\/api\/crm\/leads\/[a-f0-9-]{36}\/activity$/.test(path)&&request.method==='GET'){
  const id=path.split('/')[4];const q=new URLSearchParams({select:'*',lead_id:'eq.'+id,order:'created_at.desc,id.desc',limit:'100'});
  const b=new URLSearchParams({select:'*',lead_id:'eq.'+id,order:'starts_at.desc.nullslast',limit:'20'});
  const [events,bookings]=await Promise.all([crmSupabase(env,'/rest/v1/crm_activity?'+q,{},token),crmSupabase(env,'/rest/v1/crm_bookings?'+b,{},token)]);
  if(!events.ok||!bookings.ok)return crmReply({error:'Unable to load activity'},502);return crmReply({activity:await events.json(),bookings:await bookings.json()});
 }
 return null;
}
