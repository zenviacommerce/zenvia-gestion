-- Keep repeated fiscal/FX expressions from being inlined into every SUM branch.
-- Each row must calculate its effective VAT and rate only once.
do $migration$
declare r record; definition text;
begin
  for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'amazon_analytics_summary','amazon_analytics_summary_without_fbm_20260917',
      'amazon_analytics_detail','amazon_analytics_series_without_fbm_20260917'
    )
  loop
    definition:=pg_get_functiondef(r.oid);
    definition:=replace(definition,'finance_rows as (','finance_rows as materialized (');
    definition:=replace(definition,'corrected as (','corrected as materialized (');
    execute definition;
  end loop;
end;
$migration$;
