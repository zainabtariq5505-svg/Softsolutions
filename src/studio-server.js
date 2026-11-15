const studioId=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const studioText=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0);
const studioDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const studioStamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const studioEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function studioItems(items){return Array.isArray(items)&&items.reduce((sum,i)=>sum+Math.round((i?.qty||0)*(i?.unit_price||0)*100),0)<=999999999999&&Array.isArray(items)&&items.length>0&&items.length<=30&&items.every(i=>i&&studioText(i.description,500,true)&&typeof i.qty==='number'&&i.qty>0&&i.qty<=100000&&typeof i.unit_price==='number'&&i.unit_price>=0&&i.unit_price<=1e9&&[i.qty,i.unit_price].every(n=>Number.isFinite(n)&&Math.abs(n*100-Math.round(n*100))<0.00001));}
const studioTotal=p=>p.items.reduce((sum,i)=>sum+Math.round(i.qty*i.unit_price*100),0)/100;
function studioPrint(p){const e=studioEscape,m=n=>new Intl.NumberFormat('en',{style:'currency',currency:p.currency}).format(n);return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+e(p.title)+' — SoftSolutions</title><link rel="stylesheet" href="/portal.css"><script src="/portal.js" defer></script><link rel="icon" href="/assets/soft-solutions-monogram.jpeg"></head><body class="print-page"><main class="proposal-paper"><div class="paper-brand"><img src="/assets/soft-solutions-monogram.jpeg" width="60" height="60" alt=""><b>SoftSolutions</b><span>PROJECT PROPOSAL</span></div><button id="print-proposal">Print / Save as PDF</button><p class="eyebrow">'+e(p.status)+' · Valid through '+e(p.valid_until)+'</p><h1>'+e(p.title)+'</h1><p class="preserve">'+e(p.intro)+'</p><div class="table-scroll"><table><thead><tr><th>Deliverable</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>'+p.items.map(i=>'<tr><td>'+e(i.description)+'</td><td>'+e(i.qty)+'</td><td>'+m(i.unit_price)+'</td><td>'+m(Math.round(i.qty*i.unit_price*100)/100)+'</td></tr>').join('')+'</tbody></table></div><h2 class="proposal-total">Total '+m(studioTotal(p))+'</h2><h2>Scope & terms</h2><p class="preserve">'+e(p.terms)+'</p>'+(p.decision_at?'<p>'+e(p.status)+' by '+e(p.decision_by)+' · '+e(p.decision_at)+'</p>':'')+'<footer>SOFTSOLUTIONS / '+e(p.id)+'<p>Acceptance records a project decision. Payment, signatures, and any separate service agreement are handled with the agency.</p></footer></main></body></html>';}
async function studioRest(env,token,table,query={},method='GET',body){const result=await crmSupabase(env,'/rest/v1/'+table+'?'+new URLSearchParams(query),{method,headers:{Prefer:'return=representation,count=exact'},...(body!==undefined?{body:JSON.stringify(body)}:{})},token);if(!result.ok){const error=Error('Unable to save or load this record. Refresh and try again.');error.status=result.status===409?409:502;throw error;}return {rows:result.status===204?[]:await result.json(),total:Number((result.headers.get('content-range')||'').split('/')[1])||0};}
async function studioRoute(request,env,path,token){
 if(!path.startsWith('/api/crm/studio/'))return null;
 const part=path.slice('/api/crm/studio/'.length).split('/'),url=new URL(request.url),method=request.method;
 let d={};if(['POST','PATCH','DELETE'].includes(method)){try{d=JSON.parse(await crmBoundedBody(request,60000));}catch{return crmReply({error:'Invalid request'},400);}}
 const bad=message=>crmReply({error:message},400),get=(table,q)=>studioRest(env,token,table,q);
 try{
 if(part[0]==='today'&&method==='GET'){
 const start=url.searchParams.get('start'),end=url.searchParams.get('end');if(!studioStamp(start)||!studioStamp(end)||Date.parse(end)-Date.parse(start)<20*3600000||Date.parse(end)-Date.parse(start)>28*3600000)return bad('Invalid day range');
 const result=await crmSupabase(env,'/rest/v1/rpc/crm_today',{method:'POST',body:JSON.stringify({day_start:start,day_end:end})},token);if(!result.ok)throw Error();return crmReply(await result.json());
 }
 if(part[0]==='pipeline'&&method==='GET'){
 const stage=url.searchParams.get('stage');if(!crmStages.includes(stage))return bad('Choose a pipeline stage');
 return crmReply(await get('crm_leads',{select:'id,name,email,company,service,stage,follow_up_at,proposal_amount,proposal_currency,updated_at',stage:'eq.'+stage,order:'created_at.desc,id.asc',limit:'100',offset:String(Math.max(0,Math.min(100000,parseInt(url.searchParams.get('offset'))||0)))}));
 }
 if(part[0]==='stage'&&studioId(part[1])&&method==='PATCH'){
 if(!crmStages.includes(d.stage)||!studioStamp(d.updated_at))return bad('Invalid stage update');const r=await studioRest(env,token,'crm_leads',{id:'eq.'+part[1],updated_at:'eq.'+d.updated_at,select:'*'},'PATCH',{stage:d.stage});return r.rows.length?crmReply({lead:r.rows[0]}):crmReply({error:'This lead changed. Refresh the board before moving it again.'},409);
 }
 if(part[0]==='projects'&&!part[1]&&method==='GET')return crmReply(await get('crm_projects',{select:'*,crm_leads(name,company)',...(studioId(url.searchParams.get('lead_id'))?{lead_id:'eq.'+url.searchParams.get('lead_id')}:{}),order:'created_at.desc,id.asc',limit:'50',offset:String(Math.max(0,Math.min(100000,parseInt(url.searchParams.get('offset'))||0)))}));
 if(part[0]==='projects'&&!part[1]&&method==='POST'){
 if(!studioId(d.lead_id)||!studioText(d.title,200,true))return bad('Choose a lead and enter a project title');const r=await studioRest(env,token,'crm_projects',{select:'*'},'POST',{lead_id:d.lead_id,title:d.title.trim()});return crmReply({project:r.rows[0]},201);
 }
 if(part[0]==='projects'&&studioId(part[1])){
 const id=part[1];
 if(!part[2]&&method==='GET'){
 const [projects,milestones,resources,messages,proposals,shares]=await Promise.all([get('crm_projects',{id:'eq.'+id,select:'*,crm_leads(name,company)'}),...['crm_milestones','crm_resources','crm_messages','crm_proposals','crm_shares'].map(t=>get(t,{project_id:'eq.'+id,select:t==='crm_shares'?'id,expires_at,revoked_at,created_at':'*',order:'created_at.desc,id.asc',limit:'100'}))]);
 return projects.rows.length?crmReply({project:projects.rows[0],milestones:milestones.rows,resources:resources.rows,messages:messages.rows,proposals:proposals.rows,shares:shares.rows}):crmReply({error:'Project not found'},404);
 }
 if(!part[2]&&method==='PATCH'){
 if(!studioText(d.title,200,true)||!studioText(d.summary,5000)||!['active','paused','completed'].includes(d.status)||(d.due_at!==null&&!studioDate(d.due_at))||!studioStamp(d.updated_at))return bad('Check the project details');
 const r=await studioRest(env,token,'crm_projects',{id:'eq.'+id,updated_at:'eq.'+d.updated_at},'PATCH',{title:d.title.trim(),summary:d.summary,status:d.status,due_at:d.due_at});return r.rows.length?crmReply({project:r.rows[0]}):crmReply({error:'Project changed in another session. Reopen it before saving.'},409);
 }
 if(part[2]==='milestones'&&method==='POST'){
 if(!studioText(d.title,200,true)||!studioText(d.description||'',3000)||(d.due_at!==null&&!studioDate(d.due_at)))return bad('Check the milestone title and date');return crmReply(await studioRest(env,token,'crm_milestones',{},'POST',{project_id:id,title:d.title.trim(),description:d.description||'',due_at:d.due_at,status:'planned'}),201);
 }
 if(part[2]==='resources'&&method==='POST'){
 let u;try{u=new URL(d.url);}catch{}if(!studioText(d.label,200,true)||!studioText(d.url,1000,true)||u?.protocol!=='https:'||u.username||u.password)return bad('Enter a label and a valid HTTPS file link');return crmReply(await studioRest(env,token,'crm_resources',{},'POST',{project_id:id,label:d.label.trim(),url:d.url}),201);
 }
 if(part[2]==='messages'&&method==='POST'){
 if(!studioText(d.body,3000,true))return bad('Enter a message up to 3000 characters');return crmReply(await studioRest(env,token,'crm_messages',{},'POST',{project_id:id,author_name:'SoftSolutions team',author_role:'team',body:d.body.trim()}),201);
 }
 if(part[2]==='shares'&&method==='POST'){
 const secret=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');const hash=await studioHash(secret);
 await studioRest(env,token,'crm_shares',{},'POST',{project_id:id,token_hash:hash,expires_at:new Date(Date.now()+30*86400000).toISOString()});return crmReply({url:url.origin+'/client#'+secret,expires_in_days:30},201);
 }
 }
 if(part[0]==='milestones'&&studioId(part[1])&&method==='PATCH'){
 if(!['planned','in_progress','review','approved'].includes(d.status)||!studioStamp(d.updated_at))return bad('Invalid milestone update');const r=await studioRest(env,token,'crm_milestones',{id:'eq.'+part[1],updated_at:'eq.'+d.updated_at},'PATCH',{status:d.status});return r.rows.length?crmReply(r):crmReply({error:'Milestone changed. Refresh before trying again.'},409);
 }
 if(part[0]==='resources'&&studioId(part[1])&&method==='DELETE')return crmReply(await studioRest(env,token,'crm_resources',{id:'eq.'+part[1]},'DELETE'));
 if(part[0]==='shares'&&studioId(part[1])&&method==='DELETE')return crmReply(await studioRest(env,token,'crm_shares',{id:'eq.'+part[1]},'PATCH',{revoked_at:new Date().toISOString()}));
 if(part[0]==='proposals'){
 if(!part[1]&&method==='POST'||studioId(part[1])&&!part[2]&&method==='PATCH'){
 if(!studioText(d.title,200,true)||!studioText(d.intro,5000)||!studioText(d.terms,8000)||!studioItems(d.items)||!['USD','PKR','GBP','AED','EUR','CAD','AUD'].includes(d.currency)||!studioDate(d.valid_until))return bad('Check the proposal title, deliverables, prices, currency, and expiry date');
 const clean={title:d.title.trim(),intro:d.intro,terms:d.terms,items:d.items.map(i=>({description:i.description.trim(),qty:i.qty,unit_price:i.unit_price})),currency:d.currency,valid_until:d.valid_until};
 if(!part[1]){if(!studioId(d.project_id))return bad('Choose a client workspace');return crmReply(await studioRest(env,token,'crm_proposals',{},'POST',{...clean,project_id:d.project_id,status:'draft'}),201);}
 if(!studioStamp(d.updated_at))return bad('Reopen the proposal before saving');const r=await studioRest(env,token,'crm_proposals',{id:'eq.'+part[1],status:'eq.draft',updated_at:'eq.'+d.updated_at},'PATCH',clean);return r.rows.length?crmReply(r):crmReply({error:'Proposal was changed or published. Reopen it; published versions are locked.'},409);
 }
 if(studioId(part[1])&&part[2]==='publish'&&method==='POST'){
 if(!studioStamp(d.updated_at))return bad('Reopen the proposal');const p=(await get('crm_proposals',{id:'eq.'+part[1],status:'eq.draft',updated_at:'eq.'+d.updated_at})).rows[0];if(!p)return crmReply({error:'Proposal changed or is already published'},409);if(!p.terms.trim()||p.valid_until<new Date().toISOString().slice(0,10))return bad('Add scope/payment terms and a current expiry date before publishing');
 const r=await studioRest(env,token,'crm_proposals',{id:'eq.'+p.id,status:'eq.draft',updated_at:'eq.'+d.updated_at},'PATCH',{status:'sent'});return r.rows.length?crmReply(r):crmReply({error:'Proposal changed. Refresh before publishing.'},409);
 }
 if(studioId(part[1])&&part[2]==='print'&&method==='GET'){const p=(await get('crm_proposals',{id:'eq.'+part[1]})).rows[0];if(!p)return crmReply({error:'Proposal not found'},404);return new Response(studioPrint(p),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'"}});}
 }
 return crmReply({error:'Not found'},404);
 }catch(e){return crmReply({error:e.message||'Workspace temporarily unavailable'},e.status||502);}
}
async function studioHash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function studioPortal(request,env){
 if(request.method!=='POST')return crmReply({error:'Method not allowed'},405);
 if(request.headers.get('origin')!==new URL(request.url).origin)return crmReply({error:'Invalid origin'},403);
 let d;try{d=JSON.parse(await crmBoundedBody(request,6000));}catch{return crmReply({error:'Invalid request'},400);}
 if(!/^[a-f0-9]{64}$/.test(d.token||'')||!['view','message','approve','decision'].includes(d.action))return crmReply({error:'Invalid client link'},400);
 if(d.action!=='view'&&(!studioText(d.name,100,true)||(d.action==='message'&&!studioText(d.body,3000,true))||(['approve','decision'].includes(d.action)&&!studioId(d.id))||(d.action==='decision'&&!['accepted','declined'].includes(d.status))))return crmReply({error:'Check your name and response'},400);
 try{const r=await crmIntakeOperation(env,'portal',{payload:{token_hash:await studioHash(d.token),action:d.action,name:d.name,body:d.body,id:d.id,status:d.status}});return crmReply(r.data,r.data?.error?400:200);}catch{return crmReply({error:'Client workspace temporarily unavailable'},502);}
}
