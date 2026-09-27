-- Correct support conversation ownership and persist whose turn it is to respond.
-- Customer workspace roles are not support-agent roles: every ZENVIA Gestión user
-- writes as a customer. Only ZENVIA Platform operators write as admin.

alter table public.support_tickets
  add column if not exists last_author_role text not null default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='support_tickets_last_author_role_check'
      and conrelid='public.support_tickets'::regclass
  ) then
    alter table public.support_tickets
      add constraint support_tickets_last_author_role_check
      check(last_author_role in ('user','admin'));
  end if;
end;
$$;

-- Historical correction: messages authored by a workspace user came from the
-- customer side even when that user had the workspace admin role.
update public.support_messages m
set author_role='user'
from public.app_users au
where au.user_id=m.author_user_id
  and au.data_owner_id=m.owner_id
  and m.author_role<>'user';

-- Rebuild the persisted conversation turn from the latest message. Tickets
-- without replies start on the customer side because their description is the
-- initial customer message.
with latest_message as (
  select distinct on (m.ticket_id)
    m.ticket_id,
    m.author_role
  from public.support_messages m
  order by m.ticket_id,m.created_at desc,m.id desc
)
update public.support_tickets t
set last_author_role=coalesce(l.author_role,'user')
from latest_message l
where l.ticket_id=t.id;

update public.support_tickets t
set last_author_role='user'
where not exists (
  select 1 from public.support_messages m where m.ticket_id=t.id
);

-- Repair the visible state already affected by the old role mapping.
update public.support_tickets
set status='open',updated_at=now()
where status='waiting_user'
  and last_author_role='user';

create index if not exists support_tickets_response_turn_idx
  on public.support_tickets(last_author_role,status,last_activity_at desc);

create or replace function private.support_prepare_message()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  profile record;
  ticket_owner uuid;
  platform_operator boolean := private.app_is_platform_admin();
begin
  if auth.uid() is null then
    if coalesce(auth.role(),'')<>'service_role' then raise exception 'Sesión no válida.'; end if;

    select t.owner_id into ticket_owner
    from public.support_tickets t
    where t.id=new.ticket_id;
    if ticket_owner is null then raise exception 'Ticket no accesible.'; end if;
    if new.author_user_id is null or coalesce(trim(new.author_email),'')='' or new.author_role<>'admin' then
      raise exception 'Identidad de operador de Platform no válida.';
    end if;

    new.owner_id:=ticket_owner;
    return new;
  end if;

  if not private.app_support_ticket_access(new.ticket_id,false) then raise exception 'Ticket no accesible.'; end if;

  select t.owner_id into ticket_owner
  from public.support_tickets t
  where t.id=new.ticket_id;

  if platform_operator then
    select
      coalesce(u.email,'') as email,
      coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Soporte') as full_name
    into profile
    from auth.users u
    where u.id=auth.uid();

    new.owner_id:=ticket_owner;
    new.author_user_id:=auth.uid();
    new.author_email:=coalesce(profile.email,'');
    new.author_name:=profile.full_name;
    new.author_role:='admin';
    return new;
  end if;

  select au.email,au.full_name
  into profile
  from public.app_users au
  where au.user_id=auth.uid() and au.active=true;

  if profile.email is null then raise exception 'Usuario no autorizado.'; end if;

  new.owner_id:=ticket_owner;
  new.author_user_id:=auth.uid();
  new.author_email:=coalesce(profile.email,'');
  new.author_name:=profile.full_name;
  new.author_role:='user';
  return new;
end;
$$;

create or replace function private.support_touch_ticket()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.support_tickets
  set last_activity_at=now(),
      updated_at=now(),
      last_author_role=new.author_role,
      status=case
        when new.author_role='user' and status='waiting_user' then 'open'
        else status
      end
  where id=new.ticket_id;
  return new;
end;
$$;

notify pgrst,'reload schema';
