create or replace function public.agent_knowledge_search_authorized(p_app text,p_query text,p_permissions text[],p_limit int default 5)
returns table(id uuid,domain text,module text,screen text,route text,content text,permissions text[],action_type text,requires_confirmation boolean,integrations text[],rank real)
language sql stable security invoker set search_path=public,pg_catalog as $$
with q as (
select websearch_to_tsquery('spanish',translate(trim(coalesce(p_query,'')),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')) strict_query,
websearch_to_tsquery('spanish',regexp_replace(translate(trim(coalesce(p_query,'')),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'),'\s+',' OR ','g')) broad_query
), latest as (
select distinct on(k.module,coalesce(k.screen,'')) k.*
from public.agent_knowledge_chunks k where k.app=p_app
order by k.module,coalesce(k.screen,''),k.version desc,k.updated_at desc
),docs as (
select k.*,setweight(to_tsvector('spanish',translate(coalesce(k.module,'')||' '||coalesce(k.screen,'')||' '||array_to_string(k.keywords,' '),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'A')||setweight(to_tsvector('spanish',translate(k.content,'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'B') document from latest k where k.permissions <@ coalesce(p_permissions,'{}'::text[])
)
select d.id,d.domain,d.module,d.screen,d.route,d.content,d.permissions,d.action_type,d.requires_confirmation,d.integrations,
(ts_rank_cd(d.document,q.strict_query)*3+ts_rank_cd(d.document,q.broad_query))::real rank
from docs d,q where d.document@@q.strict_query or d.document@@q.broad_query
order by rank desc,d.updated_at desc limit greatest(1,least(coalesce(p_limit,5),10));
$$;
revoke all on function public.agent_knowledge_search_authorized(text,text,text[],int) from public,anon,authenticated;
grant execute on function public.agent_knowledge_search_authorized(text,text,text[],int) to service_role;
