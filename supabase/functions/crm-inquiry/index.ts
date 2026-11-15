const EXPECTED_HASH='3423049513f3813275e47ccfe9708839e52efba922a34a4177645d4e51709b5a';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const token=req.headers.get('x-crm-intake-key')||'';
 if(token.length!==64)return reply({error:'Unauthorized'},401);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 let diff=0;for(let i=0;i<64;i++)diff|=digest.charCodeAt(i)^EXPECTED_HASH.charCodeAt(i);
 if(diff!==0)return reply({error:'Unauthorized'},401);
 if(Number(req.headers.get('content-length'))>16000)return reply({error:'Too large'},413);
 try{
 const reader=req.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let size=0,parts=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16000){await reader.cancel();return reply({error:'Too large'},413);}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 const d=JSON.parse(new TextDecoder().decode(bytes));
 if(typeof d.name!=='string'||!d.name.trim()||d.name.length>100||typeof d.email!=='string'||!/^\S+@\S+\.\S+$/.test(d.email)||d.email.length>200||typeof d.description!=='string'||d.description.length<20||d.description.length>5000)return reply({error:'Invalid inquiry'},400);
 const lead=Object.fromEntries(['name','email','company','website','region','service','budget','description'].map(k=>[k,String(d[k]||'').trim().slice(0,k==='description'?5000:500)]));
 const master=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!master)return reply({error:'Intake unavailable'},503);
 const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/crm_receive_inquiry',{method:'POST',headers:{apikey:master,Authorization:'Bearer '+master,'Content-Type':'application/json'},body:JSON.stringify({payload:lead}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)return reply({error:'Unable to save inquiry'},r.status===400?429:502);
 return reply({ok:true});
 }catch{return reply({error:'Unable to save inquiry'},502);}
});
