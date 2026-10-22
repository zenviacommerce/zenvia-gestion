-- Backend shadow only. Preserve existing worker's internal auth mechanism without
-- printing/replacing secrets or modifying any current job.
do $$
declare cmd text;
begin
 select command into cmd from cron.job where jobname='amazon-sync-worker';
 if cmd is null or position('/amazon-sync-worker' in cmd)=0 then raise exception 'TRACKING_CRON_TEMPLATE_MISSING';end if;
 cmd:=replace(cmd,'/amazon-sync-worker','/shipment-tracking-worker');
 perform cron.schedule('zenvia-shipment-tracking-shadow','*/5 * * * *',cmd);
end;$$;
