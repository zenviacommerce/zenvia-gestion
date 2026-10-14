begin;
do $$declare owner uuid:='7461b2b7-f383-460d-b1c7-6ccbb52e42b2';store uuid:='83804406-d991-44dd-87d0-9c5bbb48f516';lease1 uuid:=gen_random_uuid();lease2 uuid:=gen_random_uuid();generation1 uuid:=gen_random_uuid();generation2 uuid:=gen_random_uuid();begin
 if not public.shopify_analytics_claim_sync(owner,store,lease1) then raise exception 'initial lease not acquired';end if;
 if public.shopify_analytics_claim_sync(owner,store,lease2) then raise exception 'overlapping lease acquired';end if;
 insert into public.shopify_analytics_catalog(owner_id,integration_account_id,variant_id,seller_sku,name,inventory_quantity,sync_generation) values(owner,store,'catalog-regression-old','old','old',9,generation1),(owner,store,'catalog-regression-new','new','new',2,generation2);
 perform public.shopify_analytics_finish_catalog(owner,store,generation2,lease1);
 if exists(select 1 from public.shopify_analytics_catalog where integration_account_id=store and variant_id='catalog-regression-old') then raise exception 'deleted variant retained ghost inventory';end if;
 if not exists(select 1 from public.shopify_analytics_catalog where integration_account_id=store and variant_id='catalog-regression-new' and inventory_quantity=2) then raise exception 'current variant lost';end if;
 perform public.shopify_analytics_release_sync(owner,store,lease1);
 if not public.shopify_analytics_claim_sync(owner,store,lease2) then raise exception 'released lease could not be claimed';end if;
 begin perform public.shopify_analytics_catalog_batch(owner,store,lease1,'[]'::jsonb);raise exception 'stale lease wrote catalog';exception when insufficient_privilege then null;end;
 begin perform public.shopify_analytics_invalidate_inventory(owner,store,lease1);raise exception 'stale lease changed inventory';exception when insufficient_privilege then null;end;
 begin perform public.shopify_analytics_finish_catalog(owner,store,generation1,lease1);raise exception 'stale lease finalized catalog';exception when insufficient_privilege then null;end;
end;$$;
rollback;
