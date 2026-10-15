-- Run the entire file with psql -v ON_ERROR_STOP=1 or Supabase execute_sql.
-- Uses two synthetic tenants/users, real authenticated role, real functions/triggers.
-- Fixtures and test helpers are ALWAYS rolled back. No Amazon/network calls.
BEGIN;
SET LOCAL statement_timeout='25s';
SET LOCAL lock_timeout='500ms';
CREATE TEMP TABLE fixture_ids(label text primary key,id uuid not null);
INSERT INTO fixture_ids SELECT label,gen_random_uuid() FROM unnest(ARRAY['wa','wb','ua','ub','sa','da','sb','pa','pb','spa','spd','spb','ia','ib','la','lb','hb']) label;
CREATE FUNCTION pg_temp.f(label text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM pg_temp.fixture_ids WHERE fixture_ids.label=$1 $$;
INSERT INTO auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data)
SELECT pg_temp.f(u),'tenant-audit-'||pg_temp.f(u)||'@example.invalid','authenticated','authenticated','{}','{}' FROM unnest(ARRAY['ua','ub']) u;
INSERT INTO public.workspaces(id,slug,name,status) SELECT pg_temp.f(w),'tenant-audit-'||pg_temp.f(w),'Rollback tenant audit','active' FROM unnest(ARRAY['wa','wb']) w;
INSERT INTO public.app_users(user_id,email,role,active,data_owner_id,workspace_id)
SELECT pg_temp.f(u),'tenant-audit-'||pg_temp.f(u)||'@example.invalid','admin',true,pg_temp.f(w),pg_temp.f(w) FROM (VALUES ('ua','wa'),('ub','wb')) v(u,w);
INSERT INTO public.suppliers(id,owner_id,name) VALUES(pg_temp.f('sa'),pg_temp.f('wa'),'Audit A source'),(pg_temp.f('da'),pg_temp.f('wa'),'Audit A destination'),(pg_temp.f('sb'),pg_temp.f('wb'),'Audit B supplier');
INSERT INTO public.products(id,owner_id,name) VALUES(pg_temp.f('pa'),pg_temp.f('wa'),'Audit product A'),(pg_temp.f('pb'),pg_temp.f('wb'),'Audit product B');
INSERT INTO public.supplier_products(id,owner_id,supplier_id,product_id,supplier_description)
VALUES(pg_temp.f('spa'),pg_temp.f('wa'),pg_temp.f('sa'),pg_temp.f('pa'),'Same description'),(pg_temp.f('spd'),pg_temp.f('wa'),pg_temp.f('da'),pg_temp.f('pa'),'Same description'),(pg_temp.f('spb'),pg_temp.f('wb'),pg_temp.f('sb'),pg_temp.f('pb'),'B description');
INSERT INTO public.invoices(id,owner_id,supplier_id,issue_date) VALUES(pg_temp.f('ia'),pg_temp.f('wa'),pg_temp.f('sa'),DATE '2026-01-15'),(pg_temp.f('ib'),pg_temp.f('wb'),pg_temp.f('sb'),DATE '2026-01-15');
INSERT INTO public.invoice_lines(id,owner_id,invoice_id,product_id,supplier_product_id,description,normalized_unit_price,unit_price,price_update_status)
VALUES(pg_temp.f('la'),pg_temp.f('wa'),pg_temp.f('ia'),pg_temp.f('pa'),pg_temp.f('spa'),'Same description',10,10,'pending'),(pg_temp.f('lb'),pg_temp.f('wb'),pg_temp.f('ib'),pg_temp.f('pb'),pg_temp.f('spb'),'B description',99,99,'pending');
INSERT INTO public.product_price_history(id,owner_id,product_id,supplier_id,invoice_id,invoice_line_id,price_date,normalized_unit_price,base_unit)
VALUES(pg_temp.f('hb'),pg_temp.f('wb'),pg_temp.f('pb'),pg_temp.f('sb'),pg_temp.f('ib'),pg_temp.f('lb'),DATE '2026-01-15',99,'ud');
CREATE FUNCTION pg_temp.snapshot(owner uuid) RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_build_object(
'suppliers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.suppliers x WHERE owner_id=$1),
'products',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.products x WHERE owner_id=$1),
'supplier_products',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.supplier_products x WHERE owner_id=$1),
'invoices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.invoices x WHERE owner_id=$1),
'invoice_lines',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.invoice_lines x WHERE owner_id=$1),
'history',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.product_price_history x WHERE owner_id=$1),
'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.audit_logs x WHERE workspace_owner_id=$1)) $$;
CREATE FUNCTION pg_temp.call_as_a(statement text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; actor uuid:=pg_temp.f('ua'); expected uuid:=pg_temp.f('wa'); actual uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 SELECT private.app_workspace_owner_id() INTO actual;
 IF actual IS DISTINCT FROM expected OR auth.uid() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Test authentication context mismatch';END IF;
 EXECUTE statement INTO result;
 RESET ROLE;
 RETURN result;
EXCEPTION WHEN OTHERS THEN RESET ROLE; RAISE;
END $$;
CREATE TEMP TABLE tenant_test_results(test text,passed boolean,detail jsonb);
DO $$
DECLARE n integer; label text; before_b jsonb; result jsonb; denied boolean; denial_state text; ok boolean; detail jsonb; sql_call text;
BEGIN
 FOR n IN 1..7 LOOP
  label:=CASE n WHEN 1 THEN 'merge legitimate A; B unchanged' WHEN 2 THEN 'merge rejects foreign destination' WHEN 3 THEN 'merge blocks foreign invoice_line mapping including FK deletion' WHEN 4 THEN 'merge blocks foreign supplier_product cascade' WHEN 5 THEN 'merge blocks trigger update to foreign history' WHEN 6 THEN 'history legitimate insert and own-row update; B unchanged' WHEN 7 THEN 'history blocks foreign conflict row' END;
  ok:=false; detail:='{}'; result:=null;
  BEGIN
   -- Deliberately malformed cross-tenant links are created only as fixture administrator.
   -- No constraints/triggers are disabled. The operation under test always runs as tenant A.
   IF n=3 THEN UPDATE public.invoice_lines SET supplier_product_id=pg_temp.f('spa') WHERE id=pg_temp.f('lb');END IF;
   IF n=4 THEN UPDATE public.supplier_products SET supplier_id=pg_temp.f('sa') WHERE id=pg_temp.f('spb');END IF;
   IF n=5 THEN UPDATE public.product_price_history SET invoice_id=pg_temp.f('ia') WHERE id=pg_temp.f('hb');END IF;
   IF n=7 THEN UPDATE public.product_price_history SET invoice_line_id=pg_temp.f('la') WHERE id=pg_temp.f('hb');END IF;
   before_b:=pg_temp.snapshot(pg_temp.f('wb'));
   denied:=false; denial_state:=null;
   IF n<=5 THEN sql_call:=format('SELECT public.configuration_merge_supplier(%L::uuid,%L::uuid)',pg_temp.f('sa'),CASE WHEN n=2 THEN pg_temp.f('sb') ELSE pg_temp.f('da') END);
   ELSE sql_call:='SELECT public.configuration_rebuild_price_history_links(true)'; END IF;
   BEGIN
    result:=pg_temp.call_as_a(sql_call);
   EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;denial_state:=SQLSTATE;
    WHEN SQLSTATE 'P0001' THEN
     IF n=2 AND SQLERRM LIKE 'Proveedor destino no encontrado%' THEN denied:=true;denial_state:=SQLSTATE;ELSE RAISE;END IF;
   END;
   IF n=1 THEN
    ok:=NOT denied AND (result->>'ok')::boolean AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=pg_temp.f('sa')) AND EXISTS(SELECT 1 FROM public.invoices WHERE id=pg_temp.f('ia') AND supplier_id=pg_temp.f('da')) AND EXISTS(SELECT 1 FROM public.invoice_lines WHERE id=pg_temp.f('la') AND supplier_product_id=pg_temp.f('spd'));
   ELSIF n=6 THEN
    ok:=NOT denied AND EXISTS(SELECT 1 FROM public.product_price_history WHERE owner_id=pg_temp.f('wa') AND invoice_line_id=pg_temp.f('la') AND normalized_unit_price=10);
    UPDATE public.invoice_lines SET normalized_unit_price=22 WHERE id=pg_temp.f('la');
    result:=pg_temp.call_as_a(sql_call);
    ok:=ok AND EXISTS(SELECT 1 FROM public.product_price_history WHERE owner_id=pg_temp.f('wa') AND invoice_line_id=pg_temp.f('la') AND normalized_unit_price=22);
   ELSE ok:=denied; END IF;
   ok:=ok AND pg_temp.snapshot(pg_temp.f('wb'))=before_b;
   detail:=jsonb_build_object('denied',denied,'sqlstate',denial_state,'tenant_b_unchanged',pg_temp.snapshot(pg_temp.f('wb'))=before_b,'result',result);
   RAISE EXCEPTION USING ERRCODE='PT001',MESSAGE='rollback individual test case';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN NULL;
   WHEN OTHERS THEN ok:=false;detail:=jsonb_build_object('unexpected_error',SQLERRM,'sqlstate',SQLSTATE);
  END;
  INSERT INTO pg_temp.tenant_test_results VALUES(label,ok,detail);
 END LOOP;
END $$;
DO $$ DECLARE failures jsonb;BEGIN
 SELECT jsonb_agg(to_jsonb(t)) INTO failures FROM pg_temp.tenant_test_results t WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'TENANT_REGRESSION_FAILED: %',failures;END IF;
END $$;
SELECT test,passed,detail FROM pg_temp.tenant_test_results ORDER BY test;
ROLLBACK;
