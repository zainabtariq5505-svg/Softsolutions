import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from './dist/server/index.js';
const base='https://studio.test',id='11111111-1111-4111-8111-111111111111',pid='22222222-2222-4222-8222-222222222222',did='33333333-3333-4333-8333-333333333333';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-publishable',SUPABASE_INTAKE_SECRET:'test-intake'};
const original=globalThis.fetch;let member=true,calls=[],stale=false;
const doc={id:did,project_id:pid,title:'A <script>proposal</script>',intro:'<img src=x onerror=alert(1)>',terms:'Written scope and payment terms',currency:'PKR',valid_until:'2099-12-31',status:'draft',items:[{description:'Edit <b>film</b>',qty:2,unit_price:125.5}],updated_at:'2026-11-15T00:00:00Z'};
globalThis.fetch=async(url,o={})=>{url=String(url);calls.push({url,o});if(url.includes('/auth/v1/user'))return Response.json({id:'staff',email:'staff@example.invalid'});if(url.includes('/crm_staff'))return Response.json(member?[{user_id:'staff'}]:[]);if(url.includes('/functions/v1/crm-inquiry'))return Response.json({ok:true,data:{project:{title:'Shared project'},proposals:[]}});if(url.includes('/rpc/crm_today'))return Response.json({new_today:1,calls:[],milestones:[],pipeline_value:[]});if(url.includes('/crm_proposals'))return Response.json(stale?[]:[{...doc,...(o.body?JSON.parse(o.body):{})}]);if(url.includes('/crm_leads'))return Response.json(stale?[]:[{id,stage:'won',notes:'Retain these notes'}],{headers:{'content-range':'0-0/1'}});if(url.includes('/crm_projects'))return Response.json([{id:pid,title:'Client project'}]);if(url.includes('/crm_shares'))return Response.json([{id:pid}]);return Response.json([]);};
const call=(path,method='GET',data,auth=true,origin=base)=>worker.fetch(new Request(base+path,{method,headers:{origin,...(auth?{cookie:'__Host-ss-crm=test-token'}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);
try{
 for(const p of ['today','projects','pipeline?stage=new','proposals/'+did+'/print'])assert.equal((await call('/api/crm/studio/'+p,'GET',undefined,false)).status,401);
 member=false;assert.equal((await call('/api/crm/studio/projects')).status,403);member=true;
 assert.equal((await call('/api/crm/studio/projects','POST',{lead_id:id,title:'Project'},true,'https://evil.test')).status,403);
 assert.equal((await call('/api/crm/studio/projects','POST',{lead_id:'bad',title:'Project'})).status,400);
 assert.equal((await call('/api/crm/studio/stage/'+id,'PATCH',{stage:'hacked',updated_at:doc.updated_at})).status,400);
 assert.equal((await call('/api/crm/studio/stage/'+id,'PATCH',{stage:'won',updated_at:doc.updated_at})).status,200);
 let last=calls.findLast(c=>c.url.includes('/crm_leads'));assert.deepEqual(JSON.parse(last.o.body),{stage:'won'});assert.match(last.url,/updated_at=eq/);
 stale=true;assert.equal((await call('/api/crm/studio/stage/'+id,'PATCH',{stage:'won',updated_at:doc.updated_at})).status,409);stale=false;
 let r=await call('/api/crm/studio/projects/'+pid+'/shares','POST',{});const share=await r.json();assert.match(share.url,/\/client#[a-f0-9]{64}$/);const secret=share.url.split('#')[1],stored=JSON.parse(calls.findLast(c=>c.url.includes('/crm_shares')).o.body);assert.equal(stored.token_hash,crypto.createHash('sha256').update(secret).digest('hex'));assert.ok(!JSON.stringify(stored).includes(secret));
 r=await call('/api/portal','POST',{token:secret,action:'view'},false);assert.equal(r.status,200);const forwarded=JSON.parse(calls.findLast(c=>c.url.includes('/functions/')).o.body);assert.equal(forwarded.operation,'portal');assert.equal(forwarded.payload.token_hash,stored.token_hash);assert.equal(forwarded.payload.token,undefined);
 assert.equal((await call('/api/portal','POST',{token:secret,action:'decision',name:'',id:did,status:'accepted'},false)).status,400);
 assert.equal((await call('/api/portal','POST',{token:secret,action:'decision',name:'Test',id:did,status:'draft'},false)).status,400);
 assert.equal((await call('/api/portal','GET',undefined,false)).status,405);
 assert.equal((await call('/api/portal','POST',{token:secret,action:'view'},false,'https://evil.test')).status,403);
 assert.equal((await call('/api/crm/studio/projects/'+pid+'/resources','POST',{label:'Unsafe',url:'javascript:alert(1)'})).status,400);
 assert.equal((await call('/api/crm/studio/projects/'+pid+'/resources','POST',{label:'Unsafe',url:'https://user:password@example.com/a'})).status,400);
 const proposal={...doc,project_id:pid};assert.equal((await call('/api/crm/studio/proposals','POST',proposal)).status,201);
 proposal.items[0].unit_price=-1;assert.equal((await call('/api/crm/studio/proposals','POST',proposal)).status,400);proposal.items[0].unit_price=1.005;assert.equal((await call('/api/crm/studio/proposals','POST',proposal)).status,400);proposal.items[0].unit_price=125.5;
 proposal.items[0].qty=0;assert.equal((await call('/api/crm/studio/proposals','POST',proposal)).status,400);proposal.items[0].qty=2;
 r=await call('/api/crm/studio/proposals/'+did+'/print');const html=await r.text();assert.equal(r.status,200);assert.ok(!html.includes('<script>proposal'));assert.match(html,/&lt;script&gt;proposal/);assert.match(html,/PKR/);assert.match(html,/251/);assert.equal(r.headers.get('cache-control'),'no-store');
 r=await call('/api/crm/studio/proposals/'+did+'/publish','POST',{updated_at:doc.updated_at});assert.equal(r.status,200);const publication=calls.findLast(c=>c.url.includes('/crm_proposals'));assert.deepEqual(JSON.parse(publication.o.body),{status:'sent'});assert.match(publication.url,/status=eq.draft/);
 for(const service of ['website-development','branding-creative','video-editing']){r=await worker.fetch(new Request(base+'/services/'+service));const page=await r.text();assert.equal(r.status,200);assert.match(page,/service-delivery-grid/);assert.match(page,/https:\/\/calendly.com\/softsolutionsagencypk\/30min/);assert.ok(!page.includes('/work/null'));}
 console.log('Studio passed: staff/origin gates, stage conflicts, hashed client links, portal validation, proposal amounts/publication locking, escaped print views, and service pages.');
}finally{globalThis.fetch=original;}
