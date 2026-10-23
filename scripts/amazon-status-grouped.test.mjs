import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261019110237_amazon_job_status_grouped_counts.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/amazon-status/index.ts',import.meta.url),'utf8');
test('four statuses counted in one query and existing index reused',()=>{
 for(const status of ['queued','running','success','failed'])assert.match(sql,new RegExp("FILTER\\(WHERE status='"+status+"'\\)"));
 assert.match(sql,/amazon_sync_jobs_owner_account_status_idx/);
});
test('RPC callable only by service role, security invoker',()=>{
 assert.match(sql,/SECURITY INVOKER/);assert.match(sql,/REVOKE ALL ON FUNCTION .* FROM PUBLIC,anon,authenticated/);assert.match(sql,/GRANT EXECUTE ON FUNCTION .* TO service_role/);
});
test('Amazon status uses grouped RPC instead of four concurrent exact counts',()=>{
 assert.match(edge,/admin\.rpc\('amazon_sync_job_status_counts'/);
 assert.doesNotMatch(edge,/\.select\('id',\{count:'exact',head:true\}\)/);
});
