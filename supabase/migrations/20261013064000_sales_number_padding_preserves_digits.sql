-- Padding is a minimum width. PostgreSQL lpad truncates when the width is smaller
-- than the counter, so retain every digit in invoices and receipts.
do $migration$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select oid from pg_proc
    where pronamespace='public'::regnamespace
      and proname in ('issue_sales_invoice','issue_sales_receipt')
      and prosrc like '%lpad(v_number_value::text,v_series.padding,%'
  loop
    v_definition:=pg_get_functiondef(v_function.oid);
    v_definition:=replace(v_definition,
      'lpad(v_number_value::text,v_series.padding,''0'')',
      'lpad(v_number_value::text,greatest(v_series.padding,length(v_number_value::text)),''0'')');
    execute v_definition;
  end loop;
end;
$migration$;

do $verification$
begin
  if lpad('51',greatest(1,length('51')),'0')<>'51'
    or lpad('7',greatest(4,length('7')),'0')<>'0007'
    or lpad('10000',greatest(4,length('10000')),'0')<>'10000' then
    raise exception 'Invoice numbering must preserve all counter digits.';
  end if;
end;
$verification$;
