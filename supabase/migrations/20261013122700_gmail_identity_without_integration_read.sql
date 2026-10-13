-- Keep stable Gmail identity compatible with restricted integration-table permissions.
create or replace function private.preserve_gmail_message_part()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  canonical public.gmail_imports%rowtype;
  peer_mailbox text;
begin
  -- Gmail registry writes cannot read the protected integration credentials table.
  new.gmail_mailbox_key := nullif(lower(trim(new.metadata->>'gmailAccountEmail')), '');
  if new.gmail_mailbox_key is null and new.integration_account_id is not null then
    select min(g.gmail_mailbox_key) into peer_mailbox
    from public.gmail_imports g where g.owner_id=new.owner_id
      and g.integration_account_id=new.integration_account_id and g.gmail_mailbox_key<>'legacy'
    having count(distinct g.gmail_mailbox_key)=1;
    new.gmail_mailbox_key := coalesce(peer_mailbox, 'integration:' || new.integration_account_id::text);
  end if;
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

