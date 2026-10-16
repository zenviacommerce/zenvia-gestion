BEGIN;
DO $$
DECLARE w uuid:=gen_random_uuid(); first_id uuid; retired_id uuid; other_workspace uuid:=gen_random_uuid(); denied boolean:=false;
BEGIN
  insert into public.workspaces(id,slug,name) values(w,'quota-test-'||w,'Shopify quota test');
  insert into public.app_subscription_state(workspace_id,plan_key,plan_name,plan_version,status,entitlements)
  values(w,'internal','Quota test',1,'active','{"shopify_accounts":{"enabled":true,"limit":1}}');
  insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,enabled,status)
  values(w,'shopify','First store','quota-first.myshopify.com',true,'pending') returning id into first_id;
  begin
    insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,enabled,status)
    values(w,'shopify','Second store','quota-second.myshopify.com',true,'pending');
  exception when raise_exception then
    if sqlerrm not like '%límite de 1 cuentas Shopify%' then raise; end if;
    denied:=true;
  end;
  if not denied then raise exception 'TEST FAILED: second store exceeded the plan limit'; end if;
  denied:=false;
  begin
    insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,enabled,status,config)
    values(w,'shopify','Fake archive','quota-fake.myshopify.com',true,'pending','{"archivedAt":"bypass"}');
  exception when raise_exception then denied:=true;
  end;
  if not denied then raise exception 'TEST FAILED: archive metadata bypassed the active quota'; end if;
  update public.integration_accounts set display_name='Reconnected first store',status='connected' where id=first_id;
  insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,enabled,status,config)
  values(w,'shopify','Retired store','quota-retired.myshopify.com',false,'disabled','{"archivedAt":"test"}') returning id into retired_id;
  denied:=false;
  begin
    update public.integration_accounts set enabled=true,status='pending',config='{}' where id=retired_id;
  exception when raise_exception then denied:=true;
  end;
  if not denied then raise exception 'TEST FAILED: archived store could be reactivated over quota'; end if;
  update public.integration_accounts set enabled=false,status='disabled' where id=first_id;
  update public.integration_accounts set enabled=true,status='pending',config='{}' where id=retired_id;
  update public.app_subscription_state set entitlements='{"shopify_accounts":{"enabled":true,"limit":null}}' where workspace_id=w;
  insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,enabled,status)
  values(w,'shopify','Unlimited store','quota-unlimited.myshopify.com',true,'pending');
  update public.app_subscription_state set entitlements='{"shopify_accounts":{"enabled":true,"limit":0}}' where workspace_id=w;
  denied:=false;
  begin
    insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,enabled,status)
    values(w,'shopify','Zero store','quota-zero.myshopify.com',true,'pending');
  exception when raise_exception then denied:=true;
  end;
  if not denied then raise exception 'TEST FAILED: zero limit accepted a new account'; end if;
  update public.app_subscription_state set entitlements='{"shopify_accounts":{"enabled":false,"limit":null}}' where workspace_id=w;
  denied:=false;
  begin
    insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,enabled,status)
    values(w,'shopify','Disabled quota','quota-disabled.myshopify.com',true,'pending');
  exception when raise_exception then denied:=true;
  end;
  if not denied then raise exception 'TEST FAILED: disabled quota accepted a new account'; end if;
  insert into public.workspaces(id,slug,name) values(other_workspace,'quota-test-'||other_workspace,'Other quota test');
  insert into public.app_subscription_state(workspace_id,plan_key,plan_name,plan_version,status,entitlements)
  values(other_workspace,'internal','Quota test',1,'active','{"shopify_accounts":{"enabled":true,"limit":1}}');
  insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,enabled,status)
  values(other_workspace,'shopify','Other workspace','quota-other.myshopify.com',true,'pending');
END $$;
ROLLBACK;
