const EXPECTED_HASH='3423049513f3813275e47ccfe9708839e52efba922a34a4177645d4e51709b5a';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const token=req.headers.get('x-crm-intake-key')||'';
 if(token.length!==64)return reply({error:'Unauthorized'},401);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 let diff=0;for(let i=0;i<64;i++)diff|=digest.charCodeAt(i)^EXPECTED_HASH.charCodeAt(i);
 if(diff!==0)return reply({error:'Unauthorized'},401);
 if(Number(req.headers.get('content-length'))>65536)return reply({error:'Too large'},413);
 try{
 const reader=req.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let size=0,parts=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return reply({error:'Too large'},413);}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 const d=JSON.parse(new TextDecoder().decode(bytes));
 const operation=d.operation||'inquiry';let rpc,params;
 if(operation==='inquiry'){
 if(typeof d.name!=='string'||!d.name.trim()||d.name.length>100||typeof d.email!=='string'||!/^\S+@\S+\.\S+$/.test(d.email)||d.email.length>200||typeof d.description!=='string'||d.description.length<20||d.description.length>5000)return reply({error:'Invalid inquiry'},400);
 const lead=Object.fromEntries(['name','email','company','website','region','service','budget','description'].map(k=>[k,String(d[k]||'').trim().slice(0,k==='description'?5000:500)]));
 const tracking=d.tracking||{};lead.tracking=Object.fromEntries(['ip','country','referrer_host','landing_path','utm_source','utm_medium','utm_campaign'].map(k=>[k,String(tracking[k]||'').slice(0,200)]));
 if(lead.tracking.country&&!/^[A-Z]{2}$/.test(lead.tracking.country))return reply({error:'Invalid country'},400);
 rpc='crm_receive_inquiry';params={payload:lead};
 }else if(operation==='calendly'){
 const b=d.booking||{};if(!['active','canceled'].includes(b.status)||typeof b.email!=='string'||!/^\S+@\S+\.\S+$/.test(b.email)||b.email.length>200||!/^https:\/\/api\.calendly\.com\//.test(b.invitee_uri||'')||!/^https:\/\/api\.calendly\.com\//.test(b.event_uri||''))return reply({error:'Invalid booking'},400);
 rpc='crm_receive_booking';params={payload:b};
 }else if(operation==='reminders.claim'){rpc='crm_claim_reminders';params={};
 }else if(operation==='reminders.finish'){
 if(!/^[a-f0-9-]{36}$/.test(d.reminder_id||'')||typeof d.was_sent!=='boolean')return reply({error:'Invalid reminder'},400);
 rpc='crm_finish_reminder';params={reminder_id:d.reminder_id,was_sent:d.was_sent,provider_message_id:typeof d.provider_id==='string'?d.provider_id.slice(0,200):null};
 }else if(operation==='maintenance'){rpc='crm_expire_ip';params={};
 }else return reply({error:'Unknown operation'},400);
 const master=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!master)return reply({error:'Intake unavailable'},503);
 const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/'+rpc,{method:'POST',headers:{apikey:master,Authorization:'Bearer '+master,'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(10000)});
 if(!r.ok)return reply({error:'Unable to save inquiry'},r.status===400?429:502);
 const data=await r.json();return operation==='inquiry'?reply({ok:true}):reply({ok:true,data});
 }catch{return reply({error:'Unable to save inquiry'},502);}
});
