-- Scope every contracted transport tariff to exactly one logistics platform.
-- Existing tariffs predate Envia.com support, so they remain Sendcloud tariffs.

alter table public.transport_tariff_documents
  add column if not exists shipping_provider text not null default 'sendcloud';

alter table public.transport_tariff_documents
  drop constraint if exists transport_tariff_documents_shipping_provider_check;

alter table public.transport_tariff_documents
  add constraint transport_tariff_documents_shipping_provider_check
  check (shipping_provider in ('sendcloud','envia'));

create index if not exists transport_tariff_documents_owner_provider_carrier_dates_idx
  on public.transport_tariff_documents(owner_id,shipping_provider,carrier_code,effective_from desc,effective_to);

create or replace function public.transport_tariff_activate(document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_document public.transport_tariff_documents%rowtype;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;

  select * into v_document from public.transport_tariff_documents
  where id=document_id and owner_id=v_owner for update;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status<>'reviewed' then raise exception 'La tarifa debe estar revisada antes de activarla'; end if;
  if v_document.effective_from is null then raise exception 'La tarifa no tiene fecha de inicio'; end if;

  update public.transport_tariff_documents
  set effective_to=v_document.effective_from-1,status='superseded',updated_at=now()
  where owner_id=v_owner
    and shipping_provider=v_document.shipping_provider
    and carrier_code=v_document.carrier_code
    and status='active'
    and id<>document_id
    and effective_from<v_document.effective_from
    and (effective_to is null or effective_to>=v_document.effective_from);

  if exists(
    select 1 from public.transport_tariff_documents d
    where d.owner_id=v_owner
      and d.shipping_provider=v_document.shipping_provider
      and d.carrier_code=v_document.carrier_code
      and d.status='active'
      and d.id<>document_id
      and daterange(d.effective_from,coalesce(d.effective_to,'infinity'::date),'[]') &&
          daterange(v_document.effective_from,coalesce(v_document.effective_to,'infinity'::date),'[]')
  ) then
    raise exception 'Existe otra tarifa activa del transportista para esta plataforma que solapa este periodo';
  end if;

  update public.transport_tariff_documents
  set status='active',activated_by=auth.uid(),activated_at=now(),updated_at=now()
  where id=document_id and owner_id=v_owner;

  return jsonb_build_object('ok',true,'status','active','shippingProvider',v_document.shipping_provider);
end;
$$;

revoke all on function public.transport_tariff_activate(uuid) from public,anon;
grant execute on function public.transport_tariff_activate(uuid) to authenticated;
