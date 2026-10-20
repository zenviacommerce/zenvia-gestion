import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const container='pickup-postgres';
function sql(query,allowFailure=false){const r=spawnSync('docker',['exec','-i',container,'psql','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:query,encoding:'utf8'});if(!allowFailure)assert.equal(r.status,0,r.stderr);return r}
function concurrentSql(query){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',container,'psql','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(out.split('\n').filter(s=>s.startsWith('{')).map(JSON.parse)));p.stdin.end(query)})}
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const expand=s=>s.replaceAll('${owner}',owner).replaceAll('${other}',other).replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(Number(n)));
const src=readFileSync('tests/pickup-reports-sql.test.ts','utf8');
const setup1=src.match(/await db\.exec\(`(CREATE ROLE[\s\S]+?)`\+readFileSync/)[1];
const setup2=src.match(/await db\.exec\(`(ALTER TABLE[\s\S]+?)`\);/)[1];
sql(expand(setup1)+readFileSync('tests/fixtures/orders-table-schema.sql','utf8')+expand(setup2));
sql(readFileSync('supabase/migrations/20261019143018_orders_dashboard_tariff_kpi_parity.sql','utf8'));
sql(readFileSync('supabase/migrations/20261020072636_pickup_reports.sql','utf8'));
const hash=sql("select md5(pg_get_functiondef('private.mfa_impl_pickup_report_create(uuid[],uuid,boolean,jsonb)'::regprocedure));").stdout.trim();
assert.equal(hash,'ecfec230cd202a5223a681d68e1a5760','Exact production create implementation must match');
const requests=[randomUUID(),randomUUID()];
const claims=`SET LOCAL ROLE authenticated; SET LOCAL test.uid='${owner}'; SET LOCAL test.owner='${owner}'; SET LOCAL test.mfa='yes'; SET LOCAL test.orders='yes';`;
const calls=[1,8].map((order,n)=>`BEGIN;${claims}
SELECT jsonb_build_object('phase','start','pid',pg_backend_pid(),'txid',txid_current(),'at',clock_timestamp());
SELECT jsonb_build_object('phase','allocated','number',public.pickup_report_create(ARRAY['${id(order)}'::uuid],'${requests[n]}'::uuid,false,'{}')->>'number','at',clock_timestamp());
SELECT pg_sleep(1.5);
SELECT jsonb_build_object('phase','before_commit','at',clock_timestamp());COMMIT;`);
const results=await Promise.all(calls.map(concurrentSql));
const starts=results.map(r=>r.find(x=>x.phase==='start')),ends=results.map(r=>r.find(x=>x.phase==='before_commit'));
const numbers=results.map(r=>r.find(x=>x.phase==='allocated').number).sort();
assert.equal(new Set(starts.map(x=>x.pid)).size,2);assert.equal(new Set(starts.map(x=>x.txid)).size,2);
assert.ok(Math.max(...starts.map(x=>Date.parse(x.at)))<Math.min(...ends.map(x=>Date.parse(x.at))),'Two independent transactions must overlap');
assert.deepEqual(numbers,['REC-2026-0001','REC-2026-0002']);
const retried=sql(`BEGIN;${claims} SELECT public.pickup_report_create(ARRAY['${id(1)}'::uuid],'${requests[0]}'::uuid,false,'{}')->>'number';COMMIT;`).stdout.trim();
assert.ok(numbers.includes(retried));
const counts=JSON.parse(sql("select jsonb_build_object('reports',(select count(*) from pickup_reports),'counter',(select last_number from private.pickup_report_counters));").stdout.trim());
assert.deepEqual(counts,{reports:2,counter:2});
const rollback=readFileSync('supabase/rollback/20261020_pickup_reports.sql','utf8');
const refused=sql(rollback,true);assert.notEqual(refused.status,0);assert.match(refused.stderr,/PICKUP_ROLLBACK_REFUSED_RECEIPTS_EXIST/);
// This is the disposable PostgreSQL container only; never run this cleanup on production.
sql('TRUNCATE public.pickup_report_items,public.pickup_reports;');sql(rollback);
const empty=JSON.parse(sql("select jsonb_build_object('table',to_regclass('public.pickup_reports'),'manifest',(select count(*) from private.mfa_function_manifest));").stdout.trim());assert.deepEqual(empty,{table:null,manifest:0});
const receipt={engine:sql('select version();').stdout.trim(),sourceHead:'4993a2f0d39bafcc43fee4927dc1afa57b564d0b',productionImplementationHash:hash,results,numbers,idempotentRetry:retried,countsBeforeCleanup:counts,rollbackRefusedNonempty:true,emptyRollback:empty,productionConnection:false};
writeFileSync('pickup-concurrency-results.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
