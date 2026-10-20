import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('minute worker cadence preserves invocation and other schedules and rolls back exactly',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create schema cron;
      create table cron.job(jobid bigint primary key,jobname text,schedule text,command text,active boolean);
      insert into cron.job values(1,'amazon-sync-worker','*/5 * * * *','existing vault-backed HTTP command',true),(2,'amazon-orders-five-minutes','*/5 * * * *','orders producer',true),(3,'other','17 * * * *','unrelated',true);
      create function cron.alter_job(job_id bigint,schedule text default null) returns void language sql as $$ update cron.job set schedule=coalesce($2,cron.job.schedule) where jobid=$1 $$;`);
    const names=fs.readdirSync('supabase/migrations').filter(name=>name.endsWith('_amazon_restore_worker_cadence.sql')).sort();
    for(const name of names)await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
    const {rows}=await db.query('select * from cron.job order by jobid');
    assert.equal(rows[0].schedule,'* * * * *');
    assert.equal(rows[0].command,'existing vault-backed HTTP command');
    assert.equal(rows[0].active,true);
    assert.equal(rows[1].schedule,'*/5 * * * *');
    assert.equal(rows[2].schedule,'17 * * * *');
    // A producer completing at 12:00:03 misses the simultaneous worker.
    // The next worker is 12:01, instead of waiting until 12:05.
    const nextMinute=rows[0].schedule==='* * * * *'?1:5;
    assert.equal(nextMinute*60-3,57);
    for(const name of names)await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
    assert.equal((await db.query('select count(*)::int count from cron.job')).rows[0].count,3);
    await db.exec(fs.readFileSync('supabase/rollback/20261020_amazon_restore_worker_cadence.sql','utf8'));
    assert.deepEqual((await db.query('select * from cron.job order by jobid')).rows,[{jobid:1,jobname:'amazon-sync-worker',schedule:'*/5 * * * *',command:'existing vault-backed HTTP command',active:true},{jobid:2,jobname:'amazon-orders-five-minutes',schedule:'*/5 * * * *',command:'orders producer',active:true},{jobid:3,jobname:'other',schedule:'17 * * * *',command:'unrelated',active:true}]);
  }finally{await db.close()}
});
