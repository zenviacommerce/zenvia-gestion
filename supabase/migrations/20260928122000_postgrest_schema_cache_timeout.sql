-- PostgREST rebuilds its schema cache after restarts/config reloads.
-- On this project pg_timezone_names can take tens of seconds, so the default
-- 8s authenticator timeout can leave the Data API permanently unavailable.
alter role authenticator set statement_timeout = '120s';
