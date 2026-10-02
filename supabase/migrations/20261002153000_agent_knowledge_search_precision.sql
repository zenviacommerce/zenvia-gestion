create or replace function public.agent_knowledge_search(p_app text,p_query text,p_limit int default 5)
returns table(id uuid,domain text,module text,screen text,route text,content text,permissions text[],action_type text,requires_confirmation boolean,integrations text[],rank real)
language sql stable security definer set search_path=public as $$
  with q as (
    select
      websearch_to_tsquery('spanish',trim(coalesce(p_query,''))) as strict_query,
      websearch_to_tsquery('spanish',regexp_replace(trim(coalesce(p_query,'')),'\s+',' OR ','g')) as broad_query
  ),
  docs as (
    select k.*,
      setweight(to_tsvector('spanish',coalesce(k.module,'')),'A') ||
      setweight(to_tsvector('spanish',coalesce(k.screen,'')),'A') ||
      setweight(to_tsvector('spanish',coalesce(array_to_string(k.keywords,' '),'')),'A') ||
      setweight(to_tsvector('spanish',coalesce(k.content,'')),'B') as document
    from public.agent_knowledge_chunks k where k.app=p_app
  )
  select d.id,d.domain,d.module,d.screen,d.route,d.content,d.permissions,d.action_type,d.requires_confirmation,d.integrations,
    (ts_rank_cd(d.document,q.strict_query)*3 + ts_rank_cd(d.document,q.broad_query))::real as rank
  from docs d,q
  where q.strict_query=''::tsquery or d.document@@q.strict_query or d.document@@q.broad_query
  order by rank desc,d.updated_at desc
  limit greatest(1,least(coalesce(p_limit,5),10));
$$;
revoke all on function public.agent_knowledge_search(text,text,int) from public;
grant execute on function public.agent_knowledge_search(text,text,int) to service_role;