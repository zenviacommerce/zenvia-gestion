-- Download handles may rotate; Gmail message ID and MIME part ID are immutable.
-- Preserve duplicate registry rows for audit, without deleting any invoice or email.
lock table public.gmail_imports in share row exclusive mode;

alter table public.gmail_imports
  add column if not exists gmail_mailbox_key text,
  add column if not exists attachment_part_id text;

update public.gmail_imports g
set gmail_mailbox_key = coalesce(
  nullif(lower(trim(g.metadata->>'gmailAccountEmail')), ''),
  (select nullif(lower(trim(a.external_account_id)), 'legacy')
   from public.integration_accounts a where a.id=g.integration_account_id and a.owner_id=g.owner_id and a.provider='gmail')),
  attachment_part_id = nullif(g.metadata->>'partId', '');

-- Identify legacy records only when their same message/part has one known mailbox.
with known as (
  select owner_id,gmail_message_id,attachment_part_id,min(gmail_mailbox_key) mailbox
  from public.gmail_imports where gmail_mailbox_key is not null
  group by owner_id,gmail_message_id,attachment_part_id
  having count(distinct gmail_mailbox_key)=1
)
update public.gmail_imports g set gmail_mailbox_key=k.mailbox
from known k where g.gmail_mailbox_key is null and g.owner_id=k.owner_id
and g.gmail_message_id=k.gmail_message_id and g.attachment_part_id=k.attachment_part_id;

update public.gmail_imports set gmail_mailbox_key='legacy' where gmail_mailbox_key is null;

-- Associate legacy canonical entries with the proven registered mailbox.
with accounts as (
 select owner_id,lower(trim(external_account_id)) mailbox,min(id::text)::uuid id
 from public.integration_accounts where provider='gmail' and external_account_id like '%@%'
 group by owner_id,lower(trim(external_account_id)) having count(*)=1
)
update public.gmail_imports g set integration_account_id=a.id
from accounts a where g.integration_account_id is null and g.owner_id=a.owner_id
and g.gmail_mailbox_key=a.mailbox;

with ranked as (
 select id,first_value(id) over (
   partition by owner_id,gmail_mailbox_key,gmail_message_id,attachment_part_id
   order by (invoice_id is not null) desc,
     case status when 'imported' then 0 when 'ignored' then 1 when 'error' then 2 else 3 end,
     created_at,id
 ) canonical_id
 from public.gmail_imports where attachment_part_id is not null
)
update public.gmail_imports g
set metadata=coalesce(g.metadata,'{}'::jsonb)||jsonb_build_object('supersededBy',r.canonical_id,'duplicateReason','gmail_message_part'),
    attachment_part_id=null
from ranked r where g.id=r.id and g.id<>r.canonical_id;

-- Previously detected self-sent documents are not supplier expenses.
update public.gmail_imports
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('gmailDirection','outgoing')
where status<>'imported' and gmail_mailbox_key<>'legacy'
and lower(coalesce(substring(sender from '<([^<>]+)>'),trim(sender)))=gmail_mailbox_key;

create unique index if not exists gmail_imports_mailbox_message_part_uidx
on public.gmail_imports(owner_id,gmail_mailbox_key,gmail_message_id,attachment_part_id);

create or replace function private.preserve_gmail_message_part()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  canonical public.gmail_imports%rowtype;
  peer_mailbox text;
begin
  new.gmail_mailbox_key := coalesce(
    nullif(lower(trim(new.metadata->>'gmailAccountEmail')), ''),
    (select nullif(lower(trim(a.external_account_id)), 'legacy')
     from public.integration_accounts a where a.id=new.integration_account_id and a.owner_id=new.owner_id and a.provider='gmail'));
  new.attachment_part_id := nullif(new.metadata->>'partId','');
  if new.gmail_mailbox_key is null and new.attachment_part_id is not null then
    select min(g.gmail_mailbox_key) into peer_mailbox
    from public.gmail_imports g where g.owner_id=new.owner_id and g.gmail_message_id=new.gmail_message_id
      and g.attachment_part_id=new.attachment_part_id and g.gmail_mailbox_key<>'legacy'
    having count(distinct g.gmail_mailbox_key)=1;
    new.gmail_mailbox_key := peer_mailbox;
  end if;
  new.gmail_mailbox_key := coalesce(new.gmail_mailbox_key,'legacy');
  if new.attachment_part_id is null then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array(new.owner_id,new.gmail_mailbox_key,new.gmail_message_id,new.attachment_part_id)::text,0));
  select * into canonical from public.gmail_imports g
  where g.owner_id=new.owner_id and g.gmail_mailbox_key=new.gmail_mailbox_key
    and g.gmail_message_id=new.gmail_message_id and g.attachment_part_id=new.attachment_part_id
  for update;
  if found then
    -- Refresh download metadata only: imported/ignored/error states and links survive rescans.
    update public.gmail_imports
    set metadata=coalesce(canonical.metadata,'{}'::jsonb)||coalesce(new.metadata,'{}'::jsonb)
      ||jsonb_build_object('latestAttachmentId',new.attachment_id),
      integration_account_id=coalesce(canonical.integration_account_id,new.integration_account_id)
    where id=canonical.id;
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists gmail_imports_stable_message_part on public.gmail_imports;
create trigger gmail_imports_stable_message_part before insert on public.gmail_imports
for each row execute function private.preserve_gmail_message_part();
