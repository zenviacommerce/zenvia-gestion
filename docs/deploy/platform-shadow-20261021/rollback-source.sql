-- Emergency shadow-only rollback. Retain outbox and version history.
begin;
update private.platform_shadow_source_config set enabled=false,drain_lease=null,drain_until=null where singleton;
select cron.unschedule(jobid) from cron.job where jobname='platform-shadow-source';
commit;
-- Verify enabled=false; no new platform-shadow-source runs. Existing application triggers,
-- bridge, Auth and MFA are untouched. An in-flight HTTP delivery is idempotent.
