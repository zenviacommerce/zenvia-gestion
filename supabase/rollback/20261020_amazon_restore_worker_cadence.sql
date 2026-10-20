-- Restore the captured production worker cadence; preserve command and active state.
do $$
declare worker record;
begin
  for worker in select jobid from cron.job where jobname='amazon-sync-worker'
  loop
    perform cron.alter_job(worker.jobid, schedule => '*/5 * * * *');
  end loop;
  if not found then
    raise exception 'amazon-sync-worker cron job is missing; restore its invocation before changing cadence';
  end if;
end;
$$;
