-- Retain only validated non-PII routing controls for grouped EU Orders jobs.
create or replace function private.amazon_pii_job_controls(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
 'region',case when p->>'region'='EU' then 'EU' end,
 'marketplace_ids',case when p->>'region'='EU'
   and jsonb_typeof(p->'marketplace_ids')='array'
   and jsonb_array_length(case when jsonb_typeof(p->'marketplace_ids')='array' then p->'marketplace_ids' else '[]'::jsonb end) between 1 and 10
   and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p->'marketplace_ids')='array' then p->'marketplace_ids' else '[]'::jsonb end) v
     where jsonb_typeof(v)<>'string' or v#>>'{}' not in
       ('A1RKKUPIHCS9HS','A13V1IB3VIYZZH','A1PA6795UKMFR9','APJ6JRA9NG5V4','A1805IZSGTT6HS','A2NODRKZP88ZB9','A1C3SOZRARQ6R3','AMEN7PMS3EDWL','A28R8C7NBKEWEA','A1F83G8C2ARO7P'))
   then (select jsonb_agg(id order by id) from (select distinct v#>>'{}' id from jsonb_array_elements(case when jsonb_typeof(p->'marketplace_ids')='array' then p->'marketplace_ids' else '[]'::jsonb end) v) ids) end,
 'mode',case when p->>'mode' in ('initial','hourly','manual','reconcile') then p->>'mode' end,
 'snapshot',case when p->>'snapshot'='current' then 'current' end,
 'high_water_mark',case when p->>'high_water_mark' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then p->>'high_water_mark' end,
 'superseded',case when jsonb_typeof(p->'superseded')='boolean' then p->'superseded' end,
 'superseded_at',case when p->>'superseded_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then p->>'superseded_at' end))
$$;
