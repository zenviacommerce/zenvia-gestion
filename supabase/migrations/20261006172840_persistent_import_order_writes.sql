-- Network fetches happen outside this transaction; business writes revalidate inside it.
create function public.import_order_write(p_item uuid,p_lease uuid,p_action text,p_rows jsonb) returns void language plpgsql set search_path='' as $$
declare i public.import_job_items;j public.import_jobs;entry jsonb;columns text;values_sql text;changes text;affected integer;
begin
 select * into j from public.import_jobs where id=(select job_id from public.import_job_items where id=p_item) for update;
 select * into i from public.import_job_items where id=p_item for update;
 if j.kind not in ('shopify_orders','envia_shipments') or j.cancel_requested or i.status<>'running' or i.lease_token is distinct from p_lease or i.lease_until<=now() then raise exception 'Lease caducado o importación cancelada';end if;
 if not private.import_can_access(j.owner_id,j.module,j.created_by) then raise exception 'Permisos revocados';end if;
 perform set_config('request.jwt.claim.sub',j.created_by::text,true);
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'Lote de pedidos no válido';end if;
 for entry in select value from jsonb_array_elements(p_rows) loop
  if entry?'owner_id' and entry->>'owner_id'<>j.owner_id::text then raise exception 'Pedido de otra empresa';end if;
  entry:=entry||jsonb_build_object('owner_id',j.owner_id);
  if p_action='delete_synthetic' then
   delete from public.fulfillment_orders where id=(entry->>'id')::uuid and owner_id=j.owner_id and sendcloud_id like 'envia:%';
   continue;
  end if;
  if p_action not in ('upsert','update') then raise exception 'Acción de pedidos no válida';end if;
  if p_action='upsert' and entry?'id' then raise exception 'No se admiten identificadores internos en pedidos remotos';end if;
  if exists(select 1 from jsonb_object_keys(entry) k where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='fulfillment_orders' and c.column_name=k and c.is_generated='NEVER')) then raise exception 'Campo de pedido no válido';end if;
  if exists(select 1 from jsonb_each_text(entry) f where f.key in ('shipping_integration_account_id','source_integration_account_id') and f.value is not null and not exists(select 1 from public.integration_accounts a where a.id=f.value::uuid and a.owner_id=j.owner_id and a.enabled)) then raise exception 'Cuenta de otra empresa o desactivada';end if;
  select string_agg(format('%I',key),',' order by key),string_agg(format('(jsonb_populate_record(null::public.fulfillment_orders,$1)).%I',key),',' order by key),string_agg(format('%I=excluded.%I',key,key),',' order by key) filter(where key not in ('owner_id','sendcloud_id','created_at')) into columns,values_sql,changes from jsonb_object_keys(entry) key where key not in ('id','created_at','updated_at');
  if p_action='upsert' then
   if j.kind<>'shopify_orders' or entry->>'source_channel'<>'shopify' or coalesce(entry->>'sendcloud_id','') not like 'shopify:%' then raise exception 'Origen de pedido no válido';end if;
   execute 'insert into public.fulfillment_orders('||columns||') select '||values_sql||' on conflict(owner_id,sendcloud_id) do update set '||changes using entry;
  else
   select string_agg(format('%I=(jsonb_populate_record(null::public.fulfillment_orders,$1)).%I',key,key),',' order by key) into changes from jsonb_object_keys(entry) key where key not in ('id','owner_id','created_at','updated_at');
   if changes is null then raise exception 'Actualización vacía';end if;
   execute 'update public.fulfillment_orders set '||changes||' where id=$2 and owner_id=$3' using entry,(entry->>'id')::uuid,j.owner_id;
   get diagnostics affected=row_count;if affected<>1 then raise exception 'Pedido no disponible';end if;
  end if;
 end loop;
end $$;
revoke all on function public.import_order_write(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_order_write(uuid,uuid,text,jsonb) to service_role;
