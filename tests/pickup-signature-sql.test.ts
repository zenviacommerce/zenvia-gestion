// @vitest-environment node
import {it,expect} from 'vitest';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const owner='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',report='00000000-0000-4000-8000-000000000003',other='00000000-0000-4000-8000-000000000004';
const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash='a'.repeat(64),input={carrier:'MRW',driverName:'Synthetic driver',identifier:'TEST-PLATE',receivedAt:'2026-10-22T10:00:00Z',packages:2,signatureHash:hash,inputHash:'b'.repeat(64)};
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create schema auth;create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function private.pickup_report_owner() returns uuid language plpgsql stable as $$begin if current_setting('test.mfa',true) is distinct from 'yes' then raise exception 'MFA_REQUIRED';end if;return nullif(current_setting('test.owner',true),'')::uuid;end$$;
create table app_users(user_id uuid primary key,data_owner_id uuid,role text,active boolean,permissions text[],full_name text,email text);
create table workspaces(id uuid primary key,status text);create table pickup_reports(id uuid primary key,owner_id uuid,number text,snapshot jsonb,created_at timestamptz default now());
create table audit_logs(workspace_owner_id uuid,actor_user_id uuid,module text,action text,entity_type text,entity_id text,entity_label text,summary text,details jsonb);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;grant usage on schema storage,private to authenticated;grant select on storage.objects to authenticated;
insert into workspaces values('${owner}','active'),('${other}','active');insert into app_users values('${actor}','${owner}','admin',true,'{}','Operator test','owner@example.test');
insert into pickup_reports values('${report}','${owner}','REC-SYNTHETIC-1','{"id":"${report}","number":"REC-SYNTHETIC-1","createdAt":"2026-10-22T09:00:00Z","items":[{"carrier":"MRW","packages":2},{"carrier":"GLS","packages":1}]}',now());
`);await db.exec(readFileSync('supabase/migrations/20261022230518_pickup_report_signatures.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20261022230533_pickup_report_mail.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20261022230550_pickup_report_pii_retention.sql','utf8'));return db}
const prepare=(db:PGlite,r=uuid(1),lease=uuid(2),value=input)=>db.query<any>('select pickup_document_prepare($1,$2,$3,$4,$5,$6::jsonb) value',[owner,actor,report,r,lease,JSON.stringify(value)]).then(r=>r.rows[0].value);
const complete=async(db:PGlite,r=uuid(1),lease=uuid(2))=>db.query<any>('select pickup_document_complete($1,$2,$3,$4,$5,$6::jsonb) value',[owner,actor,report,r,lease,JSON.stringify({pdfHash:hash,stampPath:(await db.query<any>('select stamp_path from private.pickup_document_state where report_id=$1',[report])).rows[0]?.stamp_path||`${owner}/${report}/${r}/stamp.png`,logoPath:null})]).then(r=>r.rows[0].value);
it('serializes signatures, commits after artifact persistence, preserves hashes and refuses overwrite',async()=>{const db=await setup();try{
 const prepared=await prepare(db);expect(prepared.status).toBe('prepared');expect(prepared.pdfPath).toContain(report);await expect(prepare(db,uuid(3),uuid(4),{...input,carrier:'GLS'})).rejects.toThrow('PICKUP_BUSY');
 const first=await complete(db);expect(first.status).toBe('partial');expect(first.signatures).toHaveLength(1);expect(JSON.stringify(first)).not.toContain(input.identifier);
 expect((await prepare(db)).status).toBe('completed');await expect(prepare(db,uuid(3))).rejects.toThrow('PICKUP_CARRIER_ALREADY_SIGNED');
 await prepare(db,uuid(3),uuid(4),{...input,carrier:'GLS',packages:1,inputHash:'c'.repeat(64)});const done=await complete(db,uuid(3),uuid(4));expect(done.status).toBe('signed');expect(done.signedBy).toBe(actor);expect(done.signedAt).toBeTruthy();
 await expect(db.exec("update private.pickup_document_signatures set identifier='changed'")).rejects.toThrow('PICKUP_SIGNATURE_IMMUTABLE');
 expect((await db.query<any>('select details::text from audit_logs')).rows.map(x=>x.details).join('')).not.toContain('TEST-PLATE');
 }finally{await db.close()}},20000);
it('rejects forged actor, foreign owner, wrong carrier and direct authenticated mutation',async()=>{const db=await setup();try{
 await expect(prepare(db,uuid(1),uuid(2),{...input,carrier:'UNKNOWN'})).rejects.toThrow('PICKUP_CARRIER_NOT_FOUND');await db.exec(`update app_users set data_owner_id='${other}'`);await expect(prepare(db)).rejects.toThrow('PICKUP_ACCESS_DENIED');await db.exec(`update app_users set data_owner_id='${owner}';set role authenticated`);await expect(prepare(db)).rejects.toThrow('permission denied');
 }finally{await db.close()}},20000);
it('vetoes changed retries, prevents void during a live signature and records a PII-free annulment audit',async()=>{const db=await setup();try{
 await prepare(db);await expect(prepare(db,uuid(1),uuid(2),{...input,inputHash:'d'.repeat(64)})).rejects.toThrow('PICKUP_REQUEST_REUSED');await expect(db.query('select pickup_document_void($1,$2,$3,$4)',[owner,actor,report,'Wrong driver'])).rejects.toThrow('PICKUP_BUSY');await complete(db);const result=await db.query<any>('select pickup_document_void($1,$2,$3,$4) value',[owner,actor,report,'Wrong TEST-PLATE details']);expect(result.rows[0].value.status).toBe('void');await expect(prepare(db,uuid(8),uuid(9))).rejects.toThrow('PICKUP_REPORT_VOID');expect(JSON.stringify((await db.query('select * from audit_logs')).rows)).not.toContain('TEST-PLATE');
 }finally{await db.close()}},20000);
it('reserves Gmail limits atomically, deduplicates request IDs and makes uncertain sends non-retryable',async()=>{const db=await setup();try{
 const mail=(request:string,to='driver@example.test')=>db.query<any>('select pickup_document_mail_prepare($1,$2,$3,$4,$5,$6,$7) value',[owner,actor,report,request,to,hash,false]).then(r=>r.rows[0].value);
 expect((await mail(uuid(20))).status).toBe('sending');expect((await mail(uuid(20))).retry).toBe(false);await db.query('select pickup_document_mail_finish($1,$2,$3,$4,$5,$6)',[owner,actor,uuid(20),'unknown',null,'NETWORK_UNCERTAIN']);expect((await mail(uuid(20))).status).toBe('unknown');
 for(let n=21;n<30;n++)await mail(uuid(n),`driver${n}@example.test`);await expect(mail(uuid(30),'last@example.test')).rejects.toThrow('PICKUP_MAIL_RATE_LIMIT');
 }finally{await db.close()}},20000);
it('serves only the committed PDF to the current MFA workspace and never exposes signature PNGs',async()=>{const db=await setup();try{
 const staged=await prepare(db);await complete(db);await db.query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['pickup-report-documents',staged.pdfPath,staged.signaturePath]);
 await db.exec(`set test.mfa='yes';set test.owner='${owner}';set role authenticated`);expect((await db.query('select name from storage.objects')).rows).toEqual([{name:staged.pdfPath}]);await expect(db.query('select * from private.pickup_document_signatures')).rejects.toThrow('permission denied');
 await db.exec(`set test.owner='${other}'`);expect((await db.query('select name from storage.objects')).rows).toHaveLength(0);await db.exec(`set test.owner='${owner}';set test.mfa='no'`);await expect(db.query('select name from storage.objects')).rejects.toThrow('MFA_REQUIRED');
 }finally{await db.close()}},20000);
it('purges expired PII only after Storage deletion, retaining signed hashes and audit metadata',async()=>{const db=await setup();try{
 const staged=await prepare(db);await complete(db);await db.exec("update private.pickup_document_state set expires_at=now()-interval '1 day'");await db.query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['pickup-report-documents',staged.pdfPath,staged.signaturePath]);
 expect((await db.query<any>('select pickup_document_purge_claim($1,20) value',[uuid(90)])).rows[0].value).toEqual([]);
 const counts=(await db.query<any>('select pickup_document_retention_counts() value')).rows[0].value;expect(counts.enabled).toBe(false);expect(counts.retentionDays).toBe(365);expect(counts.reports).toBe(1);
 await db.exec('update private.pickup_document_config set purge_enabled=true');
 const targets=(await db.query<any>('select pickup_document_purge_claim($1,20) value',[uuid(90)])).rows[0].value;expect(targets).toHaveLength(1);expect(targets[0].paths).toContain(staged.pdfPath);expect(JSON.stringify(targets)).not.toContain(input.identifier);
 const finish=()=>db.query('select pickup_document_purge_finish($1,$2,$3,$4)',[uuid(90),'report',owner,report]);await expect(finish()).rejects.toThrow('PICKUP_REDACTED_PDF_REQUIRED');
 const reduced=`${owner}/${report}/retention/report.pdf`;await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['pickup-report-documents',reduced]);await db.query('select pickup_document_purge_stage($1,$2,$3,$4)',[uuid(90),owner,report,'e'.repeat(64)]);
 await expect(finish()).rejects.toThrow('PICKUP_PURGE_STORAGE_PENDING');await db.query('delete from storage.objects where name=any($1)',[[staged.pdfPath,staged.signaturePath]]);await finish();
 const state=(await db.query<any>('select * from private.pickup_document_state')).rows[0];expect(state.pdf_path).toBe(reduced);expect(state.stamp_path).toBeTruthy();expect(state.status).toBe('partial');
 const signature=(await db.query<any>('select * from private.pickup_document_signatures')).rows[0];expect(signature.identifier).toBeNull();expect(signature.driver_name).toBe(input.driverName);expect(signature.signature_path).toBeNull();expect(signature.signature_hash).toBe(hash);
 expect((await db.query<any>('select pii_purged_at from private.pickup_document_state')).rows[0].pii_purged_at).toBeTruthy();await expect(prepare(db,uuid(92),uuid(93),{...input,carrier:'GLS'})).rejects.toThrow('PICKUP_PII_PURGED');expect(JSON.stringify((await db.query('select * from audit_logs')).rows)).not.toContain(input.identifier);
 }finally{await db.close()}},20000);

it('keeps the complete signed artifact for 365 days and installs no active purge schedule',async()=>{const db=await setup();try{await prepare(db);await complete(db);const row=(await db.query<any>("select extract(epoch from (expires_at-first_signed_at))/86400 days from private.pickup_document_state")).rows[0];expect(Number(row.days)).toBe(365);expect(readFileSync('supabase/migrations/20261022230551_pickup_report_retention_cron.sql','utf8')).not.toMatch(/perform\s+cron\.schedule|select\s+cron\.schedule/i)}finally{await db.close()}},20000);
it('requires a fresh request when another carrier signs after a prepared PDF attempt',async()=>{const db=await setup();try{
 await prepare(db);await db.query('select pickup_document_release($1,$2,$3,$4,$5)',[owner,actor,report,uuid(1),uuid(2)]);
 await prepare(db,uuid(3),uuid(4),{...input,carrier:'GLS',packages:1,inputHash:'c'.repeat(64)});await complete(db,uuid(3),uuid(4));
 await expect(prepare(db)).rejects.toThrow('PICKUP_SIGNATURE_REBASE_REQUIRED');await prepare(db,uuid(5),uuid(6));expect((await complete(db,uuid(5),uuid(6))).status).toBe('signed');
}finally{await db.close()}},20000);
