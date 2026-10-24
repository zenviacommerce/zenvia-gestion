-- READ ONLY. Run before migration and again immediately after, with business
-- invoice/receipt operations paused across the migration window. Compare
-- counts and content hashes; never print fiscal parties or source documents.
BEGIN READ ONLY;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';SET LOCAL TIME ZONE 'UTC';
SELECT status,document_kind,invoice_type,count(*) AS rows,
 count(*) FILTER(WHERE status='draft' AND invoice_number IS NOT NULL) AS draft_numbers,
 count(*) FILTER(WHERE status='draft' AND reserved_number IS NOT NULL) AS draft_reservations
FROM public.sales_invoices GROUP BY 1,2,3 ORDER BY 1,2,3;
SELECT count(*) AS receipts FROM public.sales_receipts;
SELECT 'closed_invoices' AS scope,count(*) AS rows,
 md5(coalesce(string_agg((to_jsonb(i)-ARRAY['verifactu_type','rectification_mode','rectification_reason','rectification_original_number','rectification_original_date','rectification_original_base','rectification_original_tax'])::text,E'\n' ORDER BY id),'')) AS content_hash
FROM public.sales_invoices i WHERE status<>'draft'
UNION ALL
SELECT 'closed_invoice_lines',count(*),md5(coalesce(string_agg(to_jsonb(l)::text,E'\n' ORDER BY l.id),''))
FROM public.sales_invoice_lines l JOIN public.sales_invoices i ON i.id=l.invoice_id WHERE i.status<>'draft'
UNION ALL
SELECT 'legacy_receipts',count(*),md5(coalesce(string_agg((to_jsonb(r)-ARRAY['status','issued_at'])::text,E'\n' ORDER BY id),''))
FROM public.sales_receipts r
UNION ALL
SELECT 'legacy_receipt_lines',count(*),md5(coalesce(string_agg(to_jsonb(l)::text,E'\n' ORDER BY id),''))
FROM public.sales_receipt_lines l;
SELECT p.oid::regprocedure::text AS routine,md5(pg_get_functiondef(p.oid)) AS definition_hash
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN('public','private') AND p.prokind='f' AND p.prosrc ~* '(sales_invoices|sales_invoice_lines|sales_receipts|sales_receipt_lines|sales_invoice_series|sales_receipt_counters|sales_invoice_released_numbers)'
ORDER BY 1;
COMMIT;
