-- Owner-approved support subject only (max 200 characters). No body/messages or buyer fields.
create or replace function private.platform_shadow_capture() returns trigger language plpgsql security definer set search_path='' as $$
declare oldrow jsonb;newrow jsonb;oldowner uuid;newowner uuid;code text;
begin
 -- AFTER trigger: exceptions roll back only the shadow subtransaction.
 -- No serialization of whole business rows; these are the complete allowlists.
 begin
  if not exists(select 1 from private.platform_shadow_source_config where enabled) then return null;end if;
  case TG_TABLE_NAME
  when 'fulfillment_orders' then
   if TG_OP<>'INSERT' then oldrow=jsonb_build_object('owner_id',old.owner_id,'order_created_at',old.order_created_at);end if;
   if TG_OP<>'DELETE' then newrow=jsonb_build_object('owner_id',new.owner_id,'order_created_at',new.order_created_at);end if;
  when 'app_users' then
   if TG_OP<>'INSERT' then oldrow=jsonb_build_object('owner_id',old.workspace_id,'active',old.active);end if;
   if TG_OP<>'DELETE' then newrow=jsonb_build_object('owner_id',new.workspace_id,'active',new.active);end if;
  when 'amazon_accounts' then
   if TG_OP<>'INSERT' then oldrow=jsonb_build_object('owner_id',old.owner_id,'status',old.status);end if;
   if TG_OP<>'DELETE' then newrow=jsonb_build_object('owner_id',new.owner_id,'status',new.status);end if;
  when 'support_tickets' then
   if TG_OP<>'INSERT' then oldrow=jsonb_build_object('id',old.id,'owner_id',old.owner_id,'ticket_number',old.ticket_number,'subject',left(old.subject,200),'type',old.type,'status',old.status,'priority',old.priority,'assigned_to',old.assigned_to,'last_author_role',old.last_author_role,'created_at',old.created_at,'updated_at',old.updated_at,'last_activity_at',old.last_activity_at);end if;
   if TG_OP<>'DELETE' then newrow=jsonb_build_object('id',new.id,'owner_id',new.owner_id,'ticket_number',new.ticket_number,'subject',left(new.subject,200),'type',new.type,'status',new.status,'priority',new.priority,'assigned_to',new.assigned_to,'last_author_role',new.last_author_role,'created_at',new.created_at,'updated_at',new.updated_at,'last_activity_at',new.last_activity_at);end if;
  else raise exception 'SHADOW_UNEXPECTED_TABLE';
  end case;
  if TG_OP='UPDATE' and oldrow is not distinct from newrow then return null;end if;
  oldowner=(oldrow->>'owner_id')::uuid;newowner=(newrow->>'owner_id')::uuid;
  if TG_TABLE_NAME='support_tickets' then
   if oldowner is not null and (TG_OP='DELETE' or oldowner is distinct from newowner) then perform private.platform_shadow_touch(oldowner,'ticket',(oldrow->>'id')::uuid,true);end if;
   if newowner is not null then perform private.platform_shadow_touch(newowner,'ticket',(newrow->>'id')::uuid,false);end if;
  else
   if oldowner is not null and (newowner is null or oldowner<newowner) then perform private.platform_shadow_touch(oldowner,'metrics',oldowner);end if;
   if newowner is not null then perform private.platform_shadow_touch(newowner,'metrics',newowner);end if;
   if oldowner is not null and newowner is not null and oldowner>newowner then perform private.platform_shadow_touch(oldowner,'metrics',oldowner);end if;
  end if;
 exception when others then
  code=SQLSTATE;
  -- Best effort, no SQLERRM/context/row values (may contain buyer data).
  begin
   insert into private.platform_shadow_capture_failures(source_table,operation,error_code) values(TG_TABLE_NAME,TG_OP,code);
  exception when others then
   raise log 'PLATFORM_SHADOW_CAPTURE_FAILURE table=% op=% sqlstate=% logger_failed=true',TG_TABLE_NAME,TG_OP,code;
  end;
 end;
 return null;
end;$$;

create or replace function private.platform_shadow_ticket_payload(p_workspace uuid,p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ticket_number',t.ticket_number,'subject',left(t.subject,200),'type',t.type,'status',t.status,'priority',t.priority,'assigned_to',t.assigned_to,'last_author_role',t.last_author_role,'created_at',t.created_at,'updated_at',t.updated_at,'last_activity_at',t.last_activity_at)
 from public.support_tickets t where t.owner_id=p_workspace and t.id=p_id;
$$;

