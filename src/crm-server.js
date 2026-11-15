// All Supabase calls are server-side. Staff requests use their own JWT and RLS.
const crmStages = ['new','contacted','proposal','won','lost'];
function crmReady(env) { return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY); }
function crmIntakeReady(env) { return crmReady(env) && Boolean(env.SUPABASE_INTAKE_SECRET); }
function crmReply(data,status=200,extra={}) {
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
}
async function crmSupabase(env,path,options={},token) {
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:' || !/^[a-z0-9]+\.supabase\.co$/.test(base.hostname)) throw Error('Invalid database URL');
  return fetch(new URL(path,base),{...options,headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
}
async function crmSaveInquiry(env,lead) {
  const result=await crmSupabase(env,'/functions/v1/crm-inquiry',{method:'POST',headers:{'x-crm-intake-key':env.SUPABASE_INTAKE_SECRET},body:JSON.stringify(lead)});
  if(!result.ok) throw Error('CRM intake failed');
}
async function crmJson(request) {
  const text=await request.text();
  if(text.length>25000) throw Error('Request too large');
  return JSON.parse(text);
}
async function crmRoute(request,env,path) {
  const url=new URL(request.url);
  if(request.method!=='GET' && request.headers.get('origin')!==url.origin) return crmReply({error:'Invalid origin'},403);
  if(!crmReady(env)) return crmReply({error:'CRM connection is not configured yet.'},503);
  if(path==='/api/crm/login') {
    if(request.method!=='POST') return crmReply({error:'Method not allowed'},405);
    let d;try{d=await crmJson(request);}catch{return crmReply({error:'Invalid request'},400);}
    if(typeof d.email!=='string'||d.email.length>200||typeof d.password!=='string'||d.password.length>512) return crmReply({error:'Enter your email and password.'},400);
    const auth=await crmSupabase(env,'/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:d.email,password:d.password})});
    if(!auth.ok) return crmReply({error:auth.status===429?'Too many attempts. Try again later.':'Unable to sign in with those details.'},auth.status===429?429:401);
    const session=await auth.json();
    if(typeof session.access_token!=='string'||!session.user?.id) return crmReply({error:'Unable to sign in.'},502);
    const membership=await crmSupabase(env,'/rest/v1/crm_staff?select=user_id&user_id=eq.'+encodeURIComponent(session.user.id),{},session.access_token);
    if(!membership.ok || !(await membership.json()).length) return crmReply({error:'This account does not have CRM access.'},403);
    const age=Math.max(1,Math.min(3600,Number(session.expires_in)||3600));
    return crmReply({ok:true},200,{'Set-Cookie':'__Host-ss-crm='+encodeURIComponent(session.access_token)+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age='+age});
  }
  if(path==='/api/crm/logout') {
    if(request.method!=='POST') return crmReply({error:'Method not allowed'},405);
    return crmReply({ok:true},200,{'Set-Cookie':'__Host-ss-crm=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
  }
  let token;try{token=decodeURIComponent((request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-ss-crm='))?.slice(14)||'');}catch{}
  if(!token) return crmReply({error:'Please sign in.'},401);
  const userResult=await crmSupabase(env,'/auth/v1/user',{},token);
  if(!userResult.ok) return crmReply({error:'Your session expired. Please sign in again.'},401);
  const user=await userResult.json();
  const member=await crmSupabase(env,'/rest/v1/crm_staff?select=user_id&user_id=eq.'+encodeURIComponent(user.id),{},token);
  if(!member.ok || !(await member.json()).length) return crmReply({error:'CRM access is restricted to authorized staff.'},403);
  const studio=await studioRoute(request,env,path,token);if(studio)return studio;
  const feature=await crmFeatureRoute(request,env,path,token);if(feature)return feature;
  if(path==='/api/crm/me' && request.method==='GET') return crmReply({email:user.email});
  if(path==='/api/crm/summary' && request.method==='GET') {
    const result=await crmSupabase(env,'/rest/v1/rpc/crm_summary',{method:'POST',body:'{}'},token);
    if(!result.ok) return crmReply({error:'Unable to load dashboard totals.'},502);
    return crmReply(await result.json());
  }
  if(path==='/api/crm/leads' && request.method==='GET') {
    const query=new URLSearchParams({select:'*',order:'created_at.desc,id.asc',limit:'50',offset:String(Math.min(100000,Math.max(0,Number.parseInt(url.searchParams.get('offset'))||0)))});
    const stage=url.searchParams.get('stage');if(crmStages.includes(stage))query.set('stage','eq.'+stage);
    if(url.searchParams.get('overdue')==='true'){query.set('follow_up_at','lt.'+new Date().toISOString());query.set('stage','not.in.(won,lost)');}
    const search=(url.searchParams.get('search')||'').replace(/[^\p{L}\p{N}@ ._+-]/gu,'').trim().slice(0,100);
    if(search) {const pattern=search.replace(/[_%]/g,'');query.set('or','(name.ilike.*'+pattern+'*,email.ilike.*'+pattern+'*,company.ilike.*'+pattern+'*)');}
    const result=await crmSupabase(env,'/rest/v1/crm_leads?'+query,{headers:{Prefer:'count=exact'}},token);
    if(!result.ok) return crmReply({error:'Unable to load leads.'},502);
    return crmReply({leads:await result.json(),total:Number((result.headers.get('content-range')||'').split('/')[1])||0});
  }
  if(/^\/api\/crm\/leads\/[a-f0-9-]{36}$/.test(path) && request.method==='PATCH') {
    let d;try{d=await crmJson(request);}catch{return crmReply({error:'Invalid request'},400);}
    if(!crmStages.includes(d.stage)||typeof d.notes!=='string'||d.notes.length>20000||typeof d.updated_at!=='string'||!Number.isFinite(Date.parse(d.updated_at))||(d.follow_up_at!==null && (typeof d.follow_up_at!=='string'||!Number.isFinite(Date.parse(d.follow_up_at))))) return crmReply({error:'Check your stage, notes, and follow-up date.'},400);
    const proposal={};
    for(const [key,max] of [['proposal_title',200],['proposal_url',1000]])if(d[key]!==undefined){if(typeof d[key]!=='string'||d[key].length>max)return crmReply({error:'Invalid proposal details'},400);proposal[key]=d[key].trim();}
    if(proposal.proposal_url){try{if(new URL(proposal.proposal_url).protocol!=='https:')throw Error();}catch{return crmReply({error:'Proposal link must use HTTPS'},400);}}
    if(d.proposal_status!==undefined){if(!crmProposalStates.includes(d.proposal_status))return crmReply({error:'Invalid proposal status'},400);proposal.proposal_status=d.proposal_status;}
    if(d.proposal_currency!==undefined){if(typeof d.proposal_currency!=='string'||! /^(USD|PKR|GBP|AED|EUR|CAD|AUD)$/.test(d.proposal_currency))return crmReply({error:'Invalid proposal currency'},400);proposal.proposal_currency=d.proposal_currency;}
    if(d.proposal_amount!==undefined){if(d.proposal_amount!==null&&(typeof d.proposal_amount!=='number'||!Number.isFinite(d.proposal_amount)||d.proposal_amount<0||d.proposal_amount>9999999999.99||Math.abs(d.proposal_amount*100-Math.round(d.proposal_amount*100))>0.00001))return crmReply({error:'Enter a valid proposal amount with up to two decimal places'},400);proposal.proposal_amount=d.proposal_amount;}
    const query=new URLSearchParams({id:'eq.'+path.split('/').pop(),updated_at:'eq.'+d.updated_at,select:'*'});
    const result=await crmSupabase(env,'/rest/v1/crm_leads?'+query,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({stage:d.stage,notes:d.notes,follow_up_at:d.follow_up_at,...proposal})},token);
    if(!result.ok) return crmReply({error:'Unable to save this lead.'},502);
    const rows=await result.json();if(!rows.length)return crmReply({error:'This lead changed in another session. Close and refresh before editing again.'},409);
    return crmReply({lead:rows[0]});
  }
  return crmReply({error:'Not found'},404);
}

export {crmRoute,crmReady,crmIntakeReady,crmSaveInquiry};
