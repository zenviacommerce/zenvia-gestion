DO $metrics$
DECLARE request_id bigint;
BEGIN
 INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status)
 SELECT 'metrics-'||r.id,-2,jsonb_build_object('request_id',r.id,'captured_at',r.created,'status_code',r.status_code,'error',r.error_msg,
 'metrics',(SELECT coalesce(jsonb_agg(line),'[]'::jsonb) FROM regexp_split_to_table(r.content,E'\n')line WHERE line ~ '^(node_cpu_seconds_total|node_memory_(MemTotal|MemAvailable|MemFree|Buffers|Cached)_bytes|node_load[15])')),'resource_snapshot'
 FROM net._http_response r JOIN private.orders_projection_write_measurements q ON q.lane=-3 AND (q.receipt->>'request_id')::bigint=r.id
 ON CONFLICT(batch,lane) DO NOTHING;
 IF clock_timestamp()>='2026-10-23T09:15:00Z'::timestamptz THEN PERFORM cron.unschedule('orders-projection-resources-24h');RETURN;END IF;
 SELECT net.http_get(url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url')||'/customer/v1/privileged/metrics',
 headers:=jsonb_build_object('Authorization','Basic '||replace(encode(convert_to('service_role:'||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='amazon_cron_secret_key'),'UTF8'),'base64'),E'\n','')),timeout_milliseconds:=5000) INTO request_id;
 INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES('metrics-request-'||request_id,-3,jsonb_build_object('request_id',request_id),'resource_request');
END $metrics$;
