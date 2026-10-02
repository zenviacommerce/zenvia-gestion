create table if not exists public.agent_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  domain text not null,
  module text not null,
  screen text,
  route text,
  entity text,
  content text not null,
  keywords text[] not null default '{}',
  permissions text[] not null default '{}',
  action_type text not null default 'read',
  requires_confirmation boolean not null default false,
  integrations text[] not null default '{}',
  error_codes text[] not null default '{}',
  version text not null default '1',
  source_file text,
  source_commit text,
  updated_at timestamptz not null default now()
);

create index if not exists agent_knowledge_chunks_app_domain_idx on public.agent_knowledge_chunks(app,domain);

create or replace function public.agent_knowledge_search(p_app text,p_query text,p_limit int default 5)
returns table(id uuid,domain text,module text,screen text,route text,content text,permissions text[],action_type text,requires_confirmation boolean,integrations text[],rank real)
language sql
stable
security definer
set search_path=public
as $$
  with q as (select websearch_to_tsquery('spanish',coalesce(p_query,'')) as query)
  select k.id,k.domain,k.module,k.screen,k.route,k.content,k.permissions,k.action_type,k.requires_confirmation,k.integrations,
    ts_rank_cd(
      setweight(to_tsvector('spanish',coalesce(k.module,'')),'A') ||
      setweight(to_tsvector('spanish',coalesce(k.screen,'')),'A') ||
      setweight(to_tsvector('spanish',coalesce(array_to_string(k.keywords,' '),'')),'B') ||
      setweight(to_tsvector('spanish',coalesce(k.content,'')),'C'),
      q.query
    )::real rank
  from public.agent_knowledge_chunks k,q
  where k.app=p_app and (
    q.query=''::tsquery or (
      setweight(to_tsvector('spanish',coalesce(k.module,'')),'A') ||
      setweight(to_tsvector('spanish',coalesce(k.screen,'')),'A') ||
      setweight(to_tsvector('spanish',coalesce(array_to_string(k.keywords,' '),'')),'B') ||
      setweight(to_tsvector('spanish',coalesce(k.content,'')),'C')
    ) @@ q.query
  )
  order by rank desc,k.updated_at desc
  limit greatest(1,least(coalesce(p_limit,5),10));
$$;

revoke all on function public.agent_knowledge_search(text,text,int) from public;
grant execute on function public.agent_knowledge_search(text,text,int) to service_role;
