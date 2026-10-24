BEGIN READ ONLY;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';SET LOCAL TIME ZONE 'UTC';SELECT jsonb_agg(x) evidence FROM (
SELECT 'closed_invoices' scope,count(*) rows,md5(coalesce(string_agg((to_jsonb(i)-ARRAY['verifactu_type','rectification_mode','rectification_reason','rectification_original_number','rectification_original_date','rectification_original_base','rectification_original_tax'])::text,E'\n' ORDER BY id),'')) hash FROM public.sales_invoices i WHERE status<>'draft'
UNION ALL SELECT 'closed_invoice_lines',count(*),md5(coalesce(string_agg(to_jsonb(l)::text,E'\n' ORDER BY l.id),'')) FROM public.sales_invoice_lines l JOIN public.sales_invoices i ON i.id=l.invoice_id WHERE i.status<>'draft'
UNION ALL SELECT 'legacy_receipts',count(*),md5(coalesce(string_agg((to_jsonb(r)-ARRAY['status','issued_at'])::text,E'\n' ORDER BY id),'')) FROM public.sales_receipts r
UNION ALL SELECT 'legacy_receipt_lines',count(*),md5(coalesce(string_agg(to_jsonb(l)::text,E'\n' ORDER BY id),'')) FROM public.sales_receipt_lines l
UNION ALL SELECT 'payments',count(*),md5(coalesce(string_agg(to_jsonb(p)::text,E'\n' ORDER BY id),'')) FROM public.sales_payments p
UNION ALL SELECT 'receipt_payments',count(*),md5(coalesce(string_agg(to_jsonb(p)::text,E'\n' ORDER BY id),'')) FROM public.sales_receipt_payments p
)x;COMMIT;
