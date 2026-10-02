
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
  with q as (
    select websearch_to_tsquery('spanish', regexp_replace(trim(coalesce(p_query,'')), '\s+', ' OR ', 'g')) as query
  ),
  docs as (
    select k.*,
      setweight(to_tsvector('spanish',coalesce(k.module,'')),'A') ||
      setweight(to_tsvector('spanish',coalesce(k.screen,'')),'A') ||
      setweight(to_tsvector('spanish',coalesce(array_to_string(k.keywords,' '),'')),'B') ||
      setweight(to_tsvector('spanish',coalesce(k.content,'')),'C') as document
    from public.agent_knowledge_chunks k
    where k.app=p_app
  )
  select d.id,d.domain,d.module,d.screen,d.route,d.content,d.permissions,d.action_type,d.requires_confirmation,d.integrations,
         ts_rank_cd(d.document,q.query)::real as rank
  from docs d,q
  where q.query=''::tsquery or d.document @@ q.query
  order by rank desc,d.updated_at desc
  limit greatest(1,least(coalesce(p_limit,5),10));
$$;

revoke all on function public.agent_knowledge_search(text,text,int) from public;
grant execute on function public.agent_knowledge_search(text,text,int) to service_role;

insert into public.agent_knowledge_chunks(app,domain,module,screen,route,entity,content,keywords,permissions,action_type,requires_confirmation,integrations,source_file)
select * from (values
('gestion','general','Resumen','Resumen','dashboard',null,'Resumen concentra KPIs, alertas, pendientes y accesos rápidos. Los datos visibles dependen del workspace, permisos y filtros activos.',array['resumen','dashboard','kpi','pendientes'],array['dashboard'],'read',false,array[]::text[],'src/pages/Dashboard.tsx'),
('gestion','orders_shipping','Pedidos y envíos','Pedidos','orders','fulfillment_order','Pedidos centraliza pedidos de canales conectados, edición previa a etiqueta, comparación de opciones logísticas, generación de etiquetas y tracking. ZENVIA mantiene el pedido como fuente de verdad y usa el proveedor elegido cuando corresponde.',array['pedidos','envios','etiquetas','tracking','mrw','envia','sendcloud','shopify'],array['orders'],'write',true,array['amazon','shopify','mrw','envia','sendcloud'],'src/pages/Orders.tsx'),
('gestion','expenses','Gastos','Facturas de gasto','invoices','invoice','Gastos gestiona facturas recibidas: importación individual y masiva, Gmail, PDF o imagen, proveedor, categoría, base imponible, IVA, recargo, retención, total, líneas, revisión, contabilización y pago.',array['gastos','facturas de gasto','gmail','iva','importar factura'],array['invoices'],'write',true,array['gmail'],'src/pages/ExpenseInvoicesHub.tsx'),
('gestion','sales_clients','Facturación y clientes','Facturación','sales','sales_invoice','Facturación gestiona facturas emitidas, vencimientos, cobros y documentos de venta. Clientes mantiene identidad fiscal, contacto y valores comerciales reutilizados por la facturación.',array['facturacion','ventas','facturas emitidas','clientes','cobros'],array['sales','clients'],'write',true,array[]::text[],'src/pages/SalesInvoices.tsx'),
('gestion','catalog_suppliers','Productos y proveedores','Productos','products','product','Productos mantiene catálogo, SKU, EAN, unidad, IVA, costes, precios y vinculaciones. Proveedores mantiene identidad fiscal, contacto, tipo y categoría habitual.',array['productos','sku','ean','costes','proveedores'],array['products','suppliers'],'write',true,array[]::text[],'src/pages/Products.tsx'),
('gestion','amazon','Amazon','Amazon','amazon','amazon_analytics','Amazon reúne sincronización y analítica del canal: pedidos, unidades, ventas, reembolsos, rentabilidad, inventario y vinculaciones de productos.',array['amazon','asin','marketplace','rentabilidad','reembolsos','inventario'],array['amazon'],'read',false,array['amazon'],'src/pages/Amazon.tsx'),
('gestion','support','Soporte','Soporte','support','support_ticket','Soporte permite abrir y seguir tickets, adjuntos, estado y actividad. Las operaciones adicionales dependen del rol y permisos del usuario.',array['soporte','tickets','incidencias'],array['support'],'write',true,array[]::text[],'src/pages/Support.tsx'),
('gestion','settings_admin','Configuración y administración','Configuración','settings',null,'Configuración concentra empresa, facturación, gastos, pedidos, envíos, productos, clientes, proveedores, integraciones, alertas y preferencias. Administración gestiona usuarios, permisos y auditoría.',array['configuracion','integraciones','usuarios','permisos','auditoria','tema'],array['settings'],'write',true,array['amazon','shopify','mrw','envia','sendcloud','gmail'],'src/pages/Settings.tsx')
) as v(app,domain,module,screen,route,entity,content,keywords,permissions,action_type,requires_confirmation,integrations,source_file)
where not exists (
  select 1 from public.agent_knowledge_chunks k where k.app=v.app and k.domain=v.domain and k.module=v.module
);
