-- Apply only after reverting producer and draining/requeueing grouped jobs.
create or replace function private.amazon_pii_job_controls(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
 'mode',case when p->>'mode' in ('initial','hourly','manual','reconcile') then p->>'mode' end,
 'snapshot',case when p->>'snapshot'='current' then 'current' end,
 'high_water_mark',case when p->>'high_water_mark' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then p->>'high_water_mark' end,
 'superseded',case when jsonb_typeof(p->'superseded')='boolean' then p->'superseded' end,
 'superseded_at',case when p->>'superseded_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then p->>'superseded_at' end))
$$;
