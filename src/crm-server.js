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
function crmCredentials(request){
  const value=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-ss-crm='))?.slice(14);
  try{return (value||'').split('~',2).map(decodeURIComponent);}catch{return ['',''];}
}
function crmCookie(value,age){
  return '__Host-ss-crm='+value+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age='+age;
}
function crmExchangeRefresh(env,token){
  return crmSupabase(env,'/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:token})});
}
async function crmAcceptSession(env,session){
  if(typeof session.access_token!=='string'||!session.user?.id)return crmReply({error:'Unable to sign in.'},502);
  const member=await crmSupabase(env,'/rest/v1/crm_staff?select=user_id,salesos_role&user_id=eq.'+encodeURIComponent(session.user.id),{},session.access_token);
  if(!member.ok)return crmReply({error:'Unable to verify staff access.'},502);
  if(!['owner','admin'].includes((await member.json())[0]?.salesos_role))return crmReply({error:'This account does not have CRM access.'},403,{'Set-Cookie':crmCookie('',0)});
  const access=encodeURIComponent(session.access_token);
  const refresh=typeof session.refresh_token==='string'&&session.refresh_token?encodeURIComponent(session.refresh_token):'';
  const age=refresh?7*86400:Math.max(1,Math.min(3600,Number(session.expires_in)||3600));
  return crmReply({ok:true},200,{'Set-Cookie':crmCookie(refresh?access+'~'+refresh:access,age)});
}
function crmProfile(user,role){
  const name=user.user_metadata?.full_name;
  return {email:user.email,role,full_name:typeof name==='string'?name.slice(0,100):''};
}
function recoveryCookie(value,age){
  return '__Host-ss-recovery='+value+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age='+age;
}
function recoveryVerifier(request){
  const cookie=(request.headers.get('cookie')||'').split(';').map(item=>item.trim()).find(item=>item.startsWith('__Host-ss-recovery='));
  const value=cookie?.slice('__Host-ss-recovery='.length)||'';
  return /^[0-9a-f]{64}$/.test(value)?value:null;
}
async function crmRecovery(request,env,path){
  if(request.method!=='POST')return crmReply({error:'Method not allowed'},405);
  let input;
  try{input=await crmJson(request);}catch{return crmReply({error:'Invalid request.'},400);}
  if(path.endsWith('/forgot-password')){
    if(typeof input?.email!=='string'||input.email.length>200||!/^\S+@\S+\.\S+$/.test(input.email))return crmReply({error:'Enter a valid email address.'},400);
    const verifier=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
    const challenge=btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const redirect=new URL('/crm/reset-password',request.url);
    const sent=await crmSupabase(env,'/auth/v1/recover?redirect_to='+encodeURIComponent(redirect.href),{method:'POST',body:JSON.stringify({email:input.email.trim(),code_challenge:challenge,code_challenge_method:'s256'})});
    if(sent.status===429)return crmReply({error:'Too many requests. Wait before trying again.'},429);
    if(sent.status>=500)return crmReply({error:'Password recovery is temporarily unavailable.'},503);
    return crmReply({ok:true},200,{'Set-Cookie':recoveryCookie(verifier,3600)});
  }
  const verifier=recoveryVerifier(request);
  if(!verifier||typeof input?.code!=='string'||!input.code||input.code.length>512)return crmReply({error:'This recovery link is invalid or expired. Request a new link from this browser.'},400);
  if(typeof input.password!=='string'||input.password.length<12||input.password.length>128)return crmReply({error:'Use a password between 12 and 128 characters.'},400);
  const exchange=await crmSupabase(env,'/auth/v1/token?grant_type=pkce',{method:'POST',body:JSON.stringify({auth_code:input.code,code_verifier:verifier})});
  if(!exchange.ok)return crmReply({error:exchange.status>=500?'Password recovery is temporarily unavailable.':'This recovery link is invalid or expired. Request a new link.'},exchange.status>=500?503:400);
  const session=await exchange.json();
  if(!session.access_token)return crmReply({error:'Unable to verify the recovery link.'},502);
  let saved;
  try{
    saved=await crmSupabase(env,'/auth/v1/user',{method:'PUT',body:JSON.stringify({password:input.password})},session.access_token);
  }finally{
    await crmSupabase(env,'/auth/v1/logout?scope=global',{method:'POST'},session.access_token).catch(()=>{});
  }
  if(!saved.ok)return crmReply({error:'The password could not be updated. Request a new recovery link and use a different password.'},400,{'Set-Cookie':recoveryCookie('',0)});
  return crmReply({ok:true},200,{'Set-Cookie':recoveryCookie('',0)});
}
async function crmRoute(request,env,path) {
  const url=new URL(request.url);
  if(request.method!=='GET' && request.headers.get('origin')!==url.origin) return crmReply({error:'Invalid origin'},403);
  if(!crmReady(env)) return crmReply({error:'CRM connection is not configured yet.'},503);
  if(['/api/crm/forgot-password','/api/crm/reset-password'].includes(path))return crmRecovery(request,env,path);
  if(path==='/api/crm/login') {
    if(request.method!=='POST') return crmReply({error:'Method not allowed'},405);
    let d;try{d=await crmJson(request);}catch{return crmReply({error:'Invalid request'},400);}
    if(typeof d.email!=='string'||d.email.length>200||typeof d.password!=='string'||d.password.length>512) return crmReply({error:'Enter your email and password.'},400);
    const auth=await crmSupabase(env,'/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:d.email,password:d.password})});
    if(!auth.ok) return crmReply({error:auth.status===429?'Too many attempts. Try again later.':'Unable to sign in with those details.'},auth.status===429?429:401);
    const session=await auth.json();
    if(typeof session.access_token!=='string'||!session.user?.id) return crmReply({error:'Unable to sign in.'},502);
    return crmAcceptSession(env,session);
  }
  if(path==='/api/crm/refresh' || path==='/api/crm/logout'){
    if(request.method!=='POST')return crmReply({error:'Method not allowed'},405);
    const [access,refresh]=crmCredentials(request);
    if(path.endsWith('/logout')){
      let token=access;
      if(refresh && token && !(await crmSupabase(env,'/auth/v1/user',{},token)).ok){
        const refreshed=await crmExchangeRefresh(env,refresh);
        if(refreshed.ok)token=(await refreshed.json()).access_token;
        else if(refreshed.status===429||refreshed.status>=500)return crmReply({error:'Sign-out is temporarily unavailable. Try again.'},503);
        else token='';
      }
      if(token){
        const revoked=await crmSupabase(env,'/auth/v1/logout?scope=local',{method:'POST'},token);
        if(!revoked.ok && ![401,403,404].includes(revoked.status))return crmReply({error:'Sign-out is temporarily unavailable. Try again.'},503);
      }
      return crmReply({ok:true},200,{'Set-Cookie':crmCookie('',0)});
    }
    if(!refresh)return crmReply({error:'Please sign in.'},401);
    const result=await crmExchangeRefresh(env,refresh);
    if(!result.ok){
      if(result.status===429||result.status>=500)return crmReply({error:'Session refresh is temporarily unavailable.'},503);
      return crmReply({error:'Your session expired. Please sign in again.'},401,{'Set-Cookie':crmCookie('',0)});
    }
    return crmAcceptSession(env,await result.json());
  }
  const session=await crmAuthenticate(request,env);
  if(session instanceof Response)return session;
  const {token,user}=session;
  if(path==='/api/crm/metrics' && request.method==='GET'){
    const parseDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?Date.parse(value):NaN;
    const start=parseDay(url.searchParams.get('start'));
    const end=parseDay(url.searchParams.get('end'));
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>365*86400000)return crmReply({error:'Choose a valid date range up to 366 days.'},400);
    const result=await crmSupabase(env,'/rest/v1/rpc/salesos_dashboard',{method:'POST',body:JSON.stringify({range_start:new Date(start).toISOString(),range_end:new Date(end+86400000).toISOString()})},token);
    if(!result.ok)return crmReply({error:'Dashboard data is temporarily unavailable.'},502);
    return crmReply(await result.json());
  }
  const studio=await studioRoute(request,env,path,token);if(studio)return studio;
  const feature=await crmFeatureRoute(request,env,path,token);if(feature)return feature;
  if(path==='/api/crm/me' && request.method==='GET') return crmReply(crmProfile(user,session.role));
  if(path==='/api/crm/me' && request.method==='PATCH'){
    let input;
    try{input=await crmJson(request);}catch{return crmReply({error:'Invalid profile details.'},400);}
    if(!input||typeof input.full_name!=='string'||input.full_name.trim().length>100||
       Object.keys(input).some(key=>key!=='full_name'))return crmReply({error:'Enter a full name of up to 100 characters.'},400);
    const updated=await crmSupabase(env,'/auth/v1/user',{method:'PUT',body:JSON.stringify({data:{full_name:input.full_name.trim()}})},token);
    if(!updated.ok)return crmReply({error:'Unable to save your profile.'},502);
    return crmReply(crmProfile(await updated.json(),session.role));
  }
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

async function crmAuthenticate(request,env){
  if(!crmReady(env))return crmReply({error:'CRM connection is not configured yet.'},503);
  const [token]=crmCredentials(request);
  if(!token) return crmReply({error:'Please sign in.'},401);
  const userResult=await crmSupabase(env,'/auth/v1/user',{},token);
  if(userResult.status===429||userResult.status>=500)return crmReply({error:'Authentication is temporarily unavailable.'},503);
  if(!userResult.ok) return crmReply({error:'Your session expired. Please sign in again.'},401);
  const user=await userResult.json();
  const member=await crmSupabase(env,'/rest/v1/crm_staff?select=user_id,salesos_role&user_id=eq.'+encodeURIComponent(user.id),{},token);
  const role=member.ok?(await member.json())[0]?.salesos_role:null;
  if(!['owner','admin'].includes(role)) return crmReply({error:'CRM access is restricted to authorized staff.'},403);
  return {token,user,role};
}
export {crmRoute,crmReady,crmIntakeReady,crmSaveInquiry};
