-- Execute only against a database containing the atomic-page migration.
-- All fixture rows are rolled back. No live account transactions are rewritten.
begin;
do $$
declare owner uuid;account uuid;foreign_owner uuid:=gen_random_uuid();fixture_key text:='atomic-page-regression-'||gen_random_uuid()::text;
 tx jsonb;fee jsonb;refund jsonb;page jsonb;tx_id uuid;fee_id uuid;initial_tx_tid tid;initial_fee_tid tid;posted timestamptz;count_rows integer;deferred jsonb;released jsonb;deferred_key text;released_key text;direction integer;
begin
 select a.owner_id,a.id into owner,account from public.amazon_accounts a limit 1;
 if account is null then raise exception 'Fixture requires one Amazon account';end if;
 tx:=jsonb_build_object('owner_id',owner,'amazon_account_id',account,'transaction_key',fixture_key,'amazon_transaction_id',fixture_key,'transaction_type','ServiceFee','transaction_status','RELEASED','category','other_fee','amount_original',-12.1,'currency_code','EUR','posted_date',null,'related_identifiers','[]'::jsonb,'metadata','{}'::jsonb);
 fee:=jsonb_build_object('owner_id',owner,'amazon_account_id',account,'component_key','fee','component_type','Commission','component_category','commission_fee','amount_original',-12.1,'currency_code','EUR','tax_amount_original',null,'posted_date',null);
 refund:=fee||jsonb_build_object('component_key','obsolete','component_type','Storage','component_category','storage_fee','amount_original',-1);
 page:=jsonb_build_array(jsonb_build_object('transaction',tx,'components',jsonb_build_array(fee,refund)));
 perform public.amazon_replace_finance_page(owner,account,page);
 select id,ctid,posted_date into tx_id,initial_tx_tid,posted from public.amazon_finance_transactions where owner_id=owner and amazon_account_id=account and transaction_key=fixture_key;
 if tx_id is null or posted is not null then raise exception 'Null posted date not preserved';end if;
 select id,ctid into fee_id,initial_fee_tid from public.amazon_finance_components where finance_transaction_id=tx_id and component_key='fee';
 perform public.amazon_replace_finance_page(owner,account,page);
 if not exists(select 1 from public.amazon_finance_transactions where id=tx_id and ctid=initial_tx_tid) then raise exception 'Unchanged transaction rewritten';end if;
 if not exists(select 1 from public.amazon_finance_components where id=fee_id and ctid=initial_fee_tid) then raise exception 'Unchanged fee rewritten (including inferred VAT)';end if;
 fee:=fee||jsonb_build_object('amount_original',-24.2,'posted_date','2099-01-05T10:00:00Z');
 tx:=tx||jsonb_build_object('amount_original',-24.2,'posted_date','2099-01-05T10:00:00Z');
 perform public.amazon_replace_finance_page(owner,account,jsonb_build_array(jsonb_build_object('transaction',tx,'components',jsonb_build_array(fee))));
 if not exists(select 1 from public.amazon_finance_components where id=fee_id and amount_original=-24.2 and posted_date='2099-01-05T10:00:00Z') then raise exception 'Changed component did not retain ID/update economics';end if;
 if exists(select 1 from public.amazon_finance_components where finance_transaction_id=tx_id and component_key='obsolete') then raise exception 'Obsolete component retained';end if;
 -- A later invalid entry must roll the entire page back, including valid early entries.
 begin
  perform public.amazon_replace_finance_page(owner,account,jsonb_build_array(jsonb_build_object('transaction',tx||jsonb_build_object('amount_original',-99),'components',jsonb_build_array(fee)),jsonb_build_object('transaction',tx||jsonb_build_object('owner_id',foreign_owner,'transaction_key','zzzz-invalid'),'components','[]'::jsonb)));
  raise exception 'Foreign transaction accepted';
 exception when insufficient_privilege then null;end;
 if not exists(select 1 from public.amazon_finance_transactions where id=tx_id and amount_original=-24.2) then raise exception 'Page partially committed before rejected tenant';end if;
 begin
  perform public.amazon_replace_finance_page(owner,account,jsonb_build_array(jsonb_build_object('transaction',tx,'components',jsonb_build_array(fee||jsonb_build_object('owner_id',foreign_owner)))));
  raise exception 'Foreign component accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.amazon_replace_finance_page(foreign_owner,account,page);raise exception 'Foreign account accepted';
 exception when insufficient_privilege then null;end;
 -- Both provider orders must suppress Deferred components, even when keys sort oppositely.
 for direction in 1..2 loop
  deferred_key:='z-deferred-'||fixture_key||direction::text;released_key:='a-released-'||fixture_key||direction::text;
  deferred:=tx||jsonb_build_object('transaction_key',deferred_key,'amazon_transaction_id',deferred_key,'transaction_status','DEFERRED','related_identifiers','[]'::jsonb);
  released:=tx||jsonb_build_object('transaction_key',released_key,'amazon_transaction_id',released_key,'transaction_status','RELEASED','related_identifiers',jsonb_build_array(jsonb_build_object('name','DEFERRED_TRANSACTION_ID','value',deferred_key)));
  page:=case when direction=1 then jsonb_build_array(jsonb_build_object('transaction',deferred,'components',jsonb_build_array(fee)),jsonb_build_object('transaction',released,'components',jsonb_build_array(fee))) else jsonb_build_array(jsonb_build_object('transaction',released,'components',jsonb_build_array(fee)),jsonb_build_object('transaction',deferred,'components',jsonb_build_array(fee))) end;
  perform public.amazon_replace_finance_page(owner,account,page);
  select id into tx_id from public.amazon_finance_transactions where owner_id=owner and amazon_account_id=account and transaction_key=deferred_key and superseded;
  if tx_id is null then raise exception 'Deferred not superseded in provider order %',direction;end if;
  if exists(select 1 from public.amazon_finance_components where finance_transaction_id=tx_id) then raise exception 'Deferred fee double counted in provider order %',direction;end if;
  select ctid into initial_tx_tid from public.amazon_finance_transactions where id=tx_id;
  perform public.amazon_replace_finance_page(owner,account,page);
  if not exists(select 1 from public.amazon_finance_transactions where id=tx_id and ctid=initial_tx_tid) then raise exception 'Unchanged superseded ledger row rewritten';end if;
 end loop;
 -- Cross-page order: a Released entry exists before its Deferred predecessor arrives.
 deferred_key:='later-deferred-'||fixture_key;released_key:='earlier-released-'||fixture_key;
 deferred:=tx||jsonb_build_object('transaction_key',deferred_key,'amazon_transaction_id',deferred_key,'transaction_status','DEFERRED','related_identifiers','[]'::jsonb);
 released:=tx||jsonb_build_object('transaction_key',released_key,'amazon_transaction_id',released_key,'related_identifiers',jsonb_build_array(jsonb_build_object('name','DEFERRED_TRANSACTION_ID','value',deferred_key)));
 perform public.amazon_replace_finance_page(owner,account,jsonb_build_array(jsonb_build_object('transaction',released,'components',jsonb_build_array(fee))));
 perform public.amazon_replace_finance_page(owner,account,jsonb_build_array(jsonb_build_object('transaction',deferred,'components',jsonb_build_array(fee))));
 select id into tx_id from public.amazon_finance_transactions where owner_id=owner and amazon_account_id=account and transaction_key=deferred_key and superseded;
 if tx_id is null or exists(select 1 from public.amazon_finance_components where finance_transaction_id=tx_id) then raise exception 'Cross-page Deferred double counted';end if;
 -- Removing a source reference before a predecessor arrives must remove cached eligibility.
 deferred_key:='removed-reference-'||fixture_key;released_key:='changed-release-'||fixture_key;
 deferred:=tx||jsonb_build_object('transaction_key',deferred_key,'amazon_transaction_id',deferred_key,'transaction_status','DEFERRED','related_identifiers','[]'::jsonb);
 released:=tx||jsonb_build_object('transaction_key',released_key,'amazon_transaction_id',released_key,'related_identifiers',jsonb_build_array(jsonb_build_object('name','DEFERRED_TRANSACTION_ID','value',deferred_key)));
 perform public.amazon_replace_finance_page(owner,account,jsonb_build_array(jsonb_build_object('transaction',released,'components',jsonb_build_array(fee))));
 released:=released||jsonb_build_object('related_identifiers','[]'::jsonb);
 perform public.amazon_replace_finance_page(owner,account,jsonb_build_array(jsonb_build_object('transaction',released,'components',jsonb_build_array(fee))));
 if exists(select 1 from private.amazon_finance_deferred_references where owner_id=owner and amazon_account_id=account and deferred_transaction_id=deferred_key) then raise exception 'Obsolete deferred reference retained';end if;
 -- A reference with a different owner cannot mark this workspace predecessor.
 select id into tx_id from public.amazon_finance_transactions where owner_id=owner and amazon_account_id=account and transaction_key=released_key;
 insert into private.amazon_finance_deferred_references(owner_id,amazon_account_id,deferred_transaction_id,released_transaction_id) values(foreign_owner,account,deferred_key,tx_id);
 perform public.amazon_replace_finance_page(owner,account,jsonb_build_array(jsonb_build_object('transaction',deferred,'components',jsonb_build_array(fee))));
 select id into tx_id from public.amazon_finance_transactions where owner_id=owner and amazon_account_id=account and transaction_key=deferred_key and not superseded;
 if tx_id is null or not exists(select 1 from public.amazon_finance_components where finance_transaction_id=tx_id) then raise exception 'Removed or foreign reference incorrectly suppressed ledger';end if;
 if has_function_privilege('authenticated','public.amazon_replace_finance_page(uuid,uuid,jsonb)','EXECUTE') or has_function_privilege('anon','public.amazon_replace_finance_page(uuid,uuid,jsonb)','EXECUTE') then raise exception 'Browser role may write finance page';end if;
end;
$$;
rollback;
