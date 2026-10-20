-- Auditoría de solo lectura. EXPLAIN ANALYZE solo sobre SELECT.
-- Platform ucokhtztxozxcikrmidv
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT workspace_id,slug,name,legal_name,status,created_at,updated_at,metadata,plan_key,provisioning_status,infrastructure_mode,supabase_project_ref,region FROM public.customer_instances ORDER BY created_at ASC;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.platform_audit_logs ORDER BY created_at DESC LIMIT 500;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id,workspace_id,invoice_number,status,provider,issue_date,period_start,period_end,currency,subtotal_cents,tax_cents,total_cents,pdf_bucket,pdf_path,emailed_at,created_at FROM public.billing_invoices ORDER BY issue_date DESC LIMIT 200;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT user_id,email,full_name,role_key,active,last_login_at,created_at,updated_at FROM public.platform_users ORDER BY created_at ASC;
-- Clúster Gestión sjkxxbedkkmgmqnvaqjh, consultas del bridge para workspace de referencia.
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id,owner_id,ticket_number,created_by,type,subject,status,priority,assigned_to,created_at,updated_at,last_activity_at,last_author_role FROM public.support_tickets WHERE owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2' ORDER BY last_activity_at DESC LIMIT 500;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT count(*) FILTER(WHERE status IN ('open','in_progress','waiting_user')) open_count,count(*) FILTER(WHERE status IN ('open','in_progress','waiting_user') AND last_author_role='user') awaiting FROM public.support_tickets WHERE owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2';
