-- Revert frontend to index-BTiT_pl4.js first. Both RPCs were absent before release.
DROP FUNCTION IF EXISTS public.orders_dashboard_selection_v1(date,date,text,text,text,text,text,text,integer);
DROP FUNCTION IF EXISTS public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[]);
