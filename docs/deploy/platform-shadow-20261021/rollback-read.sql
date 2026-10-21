-- Central project ucokhtztxozxcikrmidv only. Keep replication running.
update private.platform_shadow_config set read_model_enabled=false where singleton;
select public.platform_shadow_read_model('{}'::jsonb);
