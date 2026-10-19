import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ids=['A1RKKUPIHCS9HS','A13V1IB3VIYZZH','A1PA6795UKMFR9','APJ6JRA9NG5V4','A1805IZSGTT6HS','A2NODRKZP88ZB9','A1C3SOZRARQ6R3','AMEN7PMS3EDWL','A1F83G8C2ARO7P'].sort();
function load(file,require,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,Date,Map,Set,JSON,console,...globals});return exports;}
function fixture(pages=[]){const writes=[],requests=[],states=[];let page=0;const admin={from(table){let action='select',value,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},neq(){return q},in(){return q},update(v){action='update';value=v;return q},upsert(v){action='upsert';value=v;return q},maybeSingle(){return Promise.resolve({data:table==='integration_accounts'?null:states.find(s=>filters.every(([k,v])=>s[k]===v)),error:null})},then(ok,bad){return Promise.resolve().then(()=>{if(action!=='select')writes.push({table,action,value});return {data:action==='update'?[{id:'job'}]:table==='amazon_sync_state'?states:[],error:null}}).then(ok,bad)}};return q}};const sync=load('supabase/functions/_shared/amazon/sync.ts',()=>({sanitizeAmazonError:String}));const orders=load('supabase/functions/_shared/amazon/orders.ts',n=>n.includes('sp-api')?{spApiRequest:async(_path,{query})=>{requests.push(query);const result=pages[page++];if(result instanceof Error)throw result;return result||{orders:[]}}}:{loadAmazonSpApiCredentials:async()=>({})});const job={id:'job',lease_holder_id:'holder',owner_id:'owner',amazon_account_id:'account',source:'orders',scope_key:'region:EU',marketplace_id:null,window_from:'2026-10-18T00:00:00Z',window_to:'2026-10-18T01:00:00Z',payload:{mode:'hourly',region:'EU',marketplace_ids:ids}};return {admin,writes,requests,states,sync,orders,job};}
test('nine marketplaces enqueue one deduplicated UTC five-minute Orders job',async()=>{const f=fixture();const account={id:'account',owner_id:'owner'};const markets=ids.concat(ids[0]).map(marketplace_id=>({marketplace_id}));const first=await f.sync.enqueueHourlySync(f.admin,account,markets,'hourly',new Date('2026-10-19T12:03:01+02:00'),['orders']);const second=await f.sync.enqueueHourlySync(f.admin,account,markets,'hourly',new Date('2026-10-19T10:04:59Z'),['orders']);assert.equal(first.length,1);assert.equal(second[0].job_key,first[0].job_key);assert.deepEqual(Array.from(first[0].payload.marketplace_ids),ids);assert.equal(first[0].scope_key,'region:EU');assert.equal(first[0].marketplace_id,null);});
test('unsupported marketplace fails closed before creating jobs',async()=>{const f=fixture();await assert.rejects(f.sync.enqueueHourlySync(f.admin,{id:'a',owner_id:'o'},[{marketplace_id:'ATVPDKIKX0DER'}],'hourly',new Date(),['orders']),/Unsupported/);assert.equal(f.writes.length,0)});
test('multiple pages route each order to its actual marketplace and checkpoint every market after completion',async()=>{const f=fixture([{orders:[{orderId:'first',salesChannel:{marketplaceId:ids[0]}}],pagination:{nextToken:'next'}},{orders:[{orderId:'last',salesChannel:{marketplaceId:ids.at(-1)}}]}]);const count=await f.orders.syncOrdersJob(f.admin,f.job);assert.deepEqual(Array.from(f.requests[0].marketplaceIds),ids);assert.equal(f.requests[1].paginationToken,'next');const rows=f.writes.filter(w=>w.table==='amazon_orders').flatMap(w=>w.value);assert.equal(rows[1].marketplace_id,ids.at(-1));assert.equal(f.writes.filter(w=>w.table==='amazon_sync_state').length,0);await f.sync.markJobSuccess(f.admin,f.job,count);const checkpoints=f.writes.filter(w=>w.table==='amazon_sync_state').flatMap(w=>w.value);assert.deepEqual(checkpoints.map(r=>r.scope_key).sort(),ids);});
test('partial API failure never advances checkpoints',async()=>{const f=fixture([{orders:[],pagination:{nextToken:'next'}},new Error('partial')]);await assert.rejects(f.orders.syncOrdersJob(f.admin,f.job),/partial/);assert.equal(f.writes.filter(w=>w.table==='amazon_sync_state').length,0)});
for(const market of [undefined,'ATVPDKIKX0DER'])test('grouped response rejects missing or out-of-scope marketplace '+market,async()=>{const f=fixture([{orders:[{orderId:'bad',salesChannel:{marketplaceId:market}}]}]);await assert.rejects(f.orders.syncOrdersJob(f.admin,f.job),/marketplace/);assert.equal(f.writes.filter(w=>w.table==='amazon_orders').length,0)});
test('group scope and region must match supported endpoint',async()=>{const f=fixture();f.job.payload.region='NA';await assert.rejects(f.orders.syncOrdersJob(f.admin,f.job),/region|scope/);assert.equal(f.requests.length,0)});
test('legacy flat jobs still request their marketplace',async()=>{const f=fixture();f.job.marketplace_id='legacy';f.job.scope_key='legacy';f.job.payload={mode:'initial'};await f.orders.syncOrdersJob(f.admin,f.job);assert.equal(f.requests[0].marketplaceIds[0],'legacy')});
test('checkpoint uses actual safe API bound and never moves a newer mark backward',async()=>{const f=fixture();f.job.window_to=new Date(Date.now()+60000).toISOString();f.states.push({owner_id:'owner',amazon_account_id:'account',source:'orders',scope_key:ids[0],high_water_mark:'2099-01-01T00:00:00Z'});await f.orders.syncOrdersJob(f.admin,f.job);await f.sync.markJobSuccess(f.admin,f.job,0);const checkpoints=f.writes.filter(w=>w.table==='amazon_sync_state').flatMap(w=>w.value);assert.equal(checkpoints.find(s=>s.scope_key===ids[0]).high_water_mark,'2099-01-01T00:00:00.000Z');assert.equal(checkpoints.find(s=>s.scope_key===ids[1]).high_water_mark,f.requests[0].lastUpdatedBefore)});
test('hourly orchestrator skips Orders incrementals while retaining initial Orders backfills',()=>{const source=fs.readFileSync('supabase/functions/amazon-sync-orchestrator/index.ts','utf8');assert.match(source,/const incrementalSources=ordersOnly\?enabledSources:enabledSources\.filter\(source=>source!=='orders'\)/);assert.match(source,/enqueueInitialBackfill\(admin,account,marketplaces,new Date\(\),enabledSources\)/);});
test('group controls survive PII allowlist and arbitrary payload cannot become routing controls',async()=>{const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();await db.exec('create schema private');const migration=fs.existsSync('supabase/migrations/20261019183000_amazon_grouped_orders_controls.sql')?fs.readFileSync('supabase/migrations/20261019183000_amazon_grouped_orders_controls.sql','utf8'):fs.readFileSync('supabase/migrations/20261016194728_amazon_pii_bounded_runner.sql','utf8').match(/create function private.amazon_pii_job_controls[\s\S]*?\$\$;/)[0];await db.exec(migration);const runner=fs.readFileSync('supabase/migrations/20261016194728_amazon_pii_bounded_runner.sql','utf8');await db.exec(runner.match(/create function private.guard_amazon_pii_controls[\s\S]*?end \$\$;/)[0]);await db.exec('create table public.amazon_sync_jobs(payload jsonb,last_error text);create trigger control_guard before insert or update on public.amazon_sync_jobs for each row execute function private.guard_amazon_pii_controls()');const payload={mode:'hourly',region:'EU',marketplace_ids:ids,secret:'buyer'};const result=await db.query('insert into public.amazon_sync_jobs(payload) values($1::jsonb) returning payload controls',[JSON.stringify(payload)]);assert.deepEqual(result.rows[0].controls,{mode:'hourly',region:'EU',marketplace_ids:ids});const rejected=await db.query('insert into public.amazon_sync_jobs(payload) values($1::jsonb) returning payload controls',[JSON.stringify({...payload,marketplace_ids:[ids[0],'private buyer']})]);assert.equal(rejected.rows[0].controls.marketplace_ids,undefined);await db.close()});
test('runtime budget exhaustion fails and retries the whole window without any checkpoint',async()=>{const f=fixture([{orders:[]}]);await assert.rejects(f.orders.syncOrdersJob(f.admin,f.job,Date.now()),/runtime budget/);assert.equal(f.requests.length,0);assert.equal(f.writes.filter(w=>w.table==='amazon_sync_state').length,0)});
test('an explicitly unsupported account region cannot enqueue grouped EU work',async()=>{const f=fixture();await assert.rejects(f.sync.enqueueHourlySync(f.admin,{id:'a',owner_id:'o',region:'NA'},ids.map(marketplace_id=>({marketplace_id})),'hourly',new Date(),['orders']),/Unsupported/)});
test('real orchestrator handler omits hourly Orders and retains initial Orders backfill',async()=>{
  let handler,hasState=true;
  const calls=[];
  const account={id:'account',owner_id:'owner'};
  const admin={from(table){const q={select(){return q},neq(){return q},eq(){return q},order(){return q},limit(){return q},insert(){return q},update(){return q},single(){return Promise.resolve({data:{id:'run'}})},then(resolve,reject){return Promise.resolve({data:table==='amazon_accounts'?[account]:table==='amazon_sync_state'?(hasState?[{id:'state'}]:[]):[],error:null}).then(resolve,reject)}};return q}};
  load('supabase/functions/amazon-sync-orchestrator/index.ts',name=>{
    if(name.includes('/supabase'))return {createAdminClient:()=>admin,requireInternalSecret:()=>{}};
    if(name.includes('/marketplaces'))return {ensureAmazonAccountAndMarketplaces:async()=>({account,marketplaces:ids.map(marketplace_id=>({marketplace_id}))})};
    if(name.includes('/settings'))return {loadAmazonAutomaticSyncSettings:async()=>({automaticEnabled:true,enabledSources:['orders','finances','inventory'],autoSyncImages:false}),filterAutomaticMarketplaces:markets=>markets};
    if(name.includes('/sync'))return {enqueueHourlySync:async(_a,_b,_c,mode,_d,sources)=>{calls.push({kind:'incremental',mode,sources});return []},enqueueInitialBackfill:async(_a,_b,_c,_d,sources)=>{calls.push({kind:'initial',sources});return []}};
    throw new Error(name);
  },{Deno:{serve:callback=>{handler=callback}},Response});
  const invoke=body=>handler({method:'POST',json:async()=>body});
  assert.equal((await invoke({mode:'hourly'})).status,200);
  assert.deepEqual(Array.from(calls[0].sources),['finances','inventory']);
  calls.length=0;
  assert.equal((await invoke({mode:'hourly',ordersOnly:true})).status,200);
  assert.deepEqual(Array.from(calls[0].sources),['orders']);
  calls.length=0;hasState=false;
  assert.equal((await invoke({mode:'hourly'})).status,200);
  assert.equal(calls[0].kind,'initial');
  assert.deepEqual(Array.from(calls[0].sources),['orders','finances','inventory']);
  assert.deepEqual(Array.from(calls[1].sources),['finances','inventory']);
});
test('worker stops claiming when its grouped-page reserve begins, without consuming another attempt',async()=>{
  let handler,background,clock=0,claims=0,completed=0,failed=0;
  class ClockDate extends Date{static now(){return clock}}
  const jobs=[{id:'first',source:'orders'},{id:'unstarted',source:'orders'}];
  const admin={rpc:async(name,args)=>{
    if(name==='amazon_claim_sync_jobs'){
      assert.equal(args.limit_count,1);
      claims+=1;
      return {data:jobs.length?[jobs.shift()]:[],error:null};
    }
    return {data:true,error:null};
  }};
  load('supabase/functions/amazon-sync-worker/index.ts',name=>{
    if(name.includes('/supabase'))return {createAdminClient:()=>admin,requireInternalSecret:()=>{}};
    if(name.includes('/sync'))return {markJobSuccess:async()=>{completed+=1},markJobFailed:async()=>{failed+=1}};
    if(name.includes('/orders'))return {syncOrdersJob:async()=>{if(clock>=150_000)throw new Error('runtime budget');clock=150_000;return 0}};
    if(name.includes('/shipment-confirmation'))return {retryPendingAmazonTracking:async()=>{}};
    return {};
  },{Deno:{serve:callback=>{handler=callback}},Response,Date:ClockDate,crypto:{randomUUID:()=> 'holder'},EdgeRuntime:{waitUntil:promise=>{background=promise}},setInterval:()=>1,clearInterval:()=>{},console:{info(){},error(){}}});
  assert.equal((await handler({method:'POST'})).status,202);
  await background;
  assert.equal(claims,1);
  assert.equal(completed,1);
  assert.equal(failed,0);
  assert.equal(jobs.length,1);
});
