-- The Orders producer runs every five minutes. Running its consumer on the
-- same boundary races enqueueing and can leave fresh jobs waiting five minutes.
-- Restore the minute cadence without replacing the deployed Vault-backed
-- invocation, job identity, permissions, enabled state, or other schedules.
do $$
declare worker record;
begin
  for worker in select jobid from cron.job where jobname='amazon-sync-worker'
  loop
    perform cron.alter_job(worker.jobid, schedule => '* * * * *');
  end loop;
  if not found then
    raise exception 'amazon-sync-worker cron job is missing; restore its invocation before changing cadence';
  end if;
end;
$$;
