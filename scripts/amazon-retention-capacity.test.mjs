import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const sql=readFileSync('scripts/sql/20261019_retention_capacity_apply.sql','utf8');
test('nightly capacity exceeds twice observed daily generation without bigger batches',()=>{const runs=3*6,batch=500;assert.ok(runs*batch>=2*3177);assert.match(sql,/\*\/10 1-3 \* \* \*/);assert.match(sql,/batch_size=500/)});
test('snapshot and guards precede schedule changes',()=>{assert.ok(sql.indexOf('INSERT INTO private.amazon_sync_jobs_retention_backup')<sql.indexOf('SELECT cron.schedule'));assert.match(sql,/Retention snapshot incomplete/);assert.match(sql,/lock_timeout='500ms'/);assert.match(sql,/status IN\('success','superseded'\)/)});
