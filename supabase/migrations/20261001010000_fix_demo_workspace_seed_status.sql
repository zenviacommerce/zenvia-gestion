-- Reinstall the demo reset function with values compatible with the current invoice-line status domain.
-- Kept as a forward migration so already-provisioned shared and dedicated projects receive the fix.

create or replace function public.platform_reset_demo_workspace(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_workspace public.workspaces%rowtype;
  v_now timestamptz:=now();
  v_year integer:=extract(year from current_date)::integer;
  v_merchandise_category uuid;
  v_transport_category uuid;
  v_software_category uuid;
  v_supplier_goods uuid:=gen_random_uuid();
  v_supplier_logistics uuid:=gen_random_uuid();
  v_supplier_software uuid:=gen_random_uuid();
  v_product_cups uuid:=gen_random_uuid();
  v_product_film uuid:=gen_random_uuid();
  v_product_bags uuid:=gen_random_uuid();
  v_product_tubs uuid:=gen_random_uuid();
  v_client_restaurant uuid:=gen_random_uuid();
  v_client_fruit uuid:=gen_random_uuid();
  v_client_catering uuid:=gen_random_uuid();
  v_purchase_1 uuid:=gen_random_uuid();
  v_purchase_2 uuid:=gen_random_uuid();
  v_purchase_3 uuid:=gen_random_uuid();
  v_sales_series uuid:=gen_random_uuid();
  v_sale_1 uuid:=gen_random_uuid();
  v_sale_2 uuid:=gen_random_uuid();
  v_amazon_account uuid:=gen_random_uuid();
  v_config jsonb;
begin
  select * into v_workspace
  from public.workspaces
  where id=p_workspace_id;

  if v_workspace.id is null then
    raise exception 'Workspace demo no encontrado.';
  end if;

  select config into v_config
  from public.app_settings
  where owner_id=p_workspace_id;

  if coalesce(v_config->'demo'->>'enabled','false')<>'true' then
    raise exception 'El workspace no está autorizado como cuenta demo.';
  end if;

  -- El reset demo es deliberadamente destructivo, pero siempre acotado al owner_id.
  delete from public.gmail_imports where owner_id=p_workspace_id;
  delete from public.fulfillment_orders where owner_id=p_workspace_id;
  delete from public.amazon_accounts where owner_id=p_workspace_id;

  delete from public.sales_payments where owner_id=p_workspace_id;
  delete from public.sales_invoice_lines where owner_id=p_workspace_id;
  delete from public.sales_invoices where owner_id=p_workspace_id;
  delete from public.sales_invoice_series where owner_id=p_workspace_id;
  delete from public.sales_receipt_payments where owner_id=p_workspace_id;
  delete from public.sales_receipt_lines where owner_id=p_workspace_id;
  delete from public.sales_receipts where owner_id=p_workspace_id;

  delete from public.product_price_history where owner_id=p_workspace_id;
  delete from public.invoice_lines where owner_id=p_workspace_id;
  delete from public.invoices where owner_id=p_workspace_id;
  delete from public.source_documents where owner_id=p_workspace_id;
  delete from public.supplier_products where owner_id=p_workspace_id;
  delete from public.products where owner_id=p_workspace_id;
  delete from public.suppliers where owner_id=p_workspace_id;
  delete from public.clients where owner_id=p_workspace_id;
  delete from public.integration_accounts where owner_id=p_workspace_id;

  insert into public.expense_categories(owner_id,name,icon,active,sort_order)
  values
    (p_workspace_id,'Mercancía','Package',true,10),
    (p_workspace_id,'Transporte','Truck',true,20),
    (p_workspace_id,'Software','Monitor',true,30)
  on conflict(owner_id,name) do update
    set active=true,updated_at=v_now;

  select id into v_merchandise_category from public.expense_categories where owner_id=p_workspace_id and name='Mercancía';
  select id into v_transport_category from public.expense_categories where owner_id=p_workspace_id and name='Transporte';
  select id into v_software_category from public.expense_categories where owner_id=p_workspace_id and name='Software';

  insert into public.business_settings(
    owner_id,legal_name,trade_name,tax_id,address_line1,postal_code,city,province,country_code,email,phone,website,invoice_footer,updated_at
  ) values (
    p_workspace_id,'Comercial Bahía Demo SL','Bahía Demo','B12345678','Avenida del Comercio 24','11011','Cádiz','Cádiz','ES',
    'administracion@example.com','600000000','https://example.com','Cuenta de demostración · Datos ficticios',v_now
  )
  on conflict(owner_id) do update set
    legal_name=excluded.legal_name,trade_name=excluded.trade_name,tax_id=excluded.tax_id,address_line1=excluded.address_line1,
    postal_code=excluded.postal_code,city=excluded.city,province=excluded.province,country_code=excluded.country_code,
    email=excluded.email,phone=excluded.phone,website=excluded.website,invoice_footer=excluded.invoice_footer,updated_at=v_now;

  insert into public.suppliers(id,owner_id,name,tax_id,email,phone,supplier_type,default_category_id,notes,active,address,website)
  values
    (v_supplier_goods,p_workspace_id,'Envases Iberia Demo SL','B11000001','ventas.envases@example.com','956000101','goods',v_merchandise_category,'Proveedor ficticio para demostraciones.',true,'Polígono Industrial Bahía, Cádiz','https://example.com'),
    (v_supplier_logistics,p_workspace_id,'Logística Atlántico Demo SL','B11000002','facturacion.logistica@example.com','956000102','service',v_transport_category,'Proveedor ficticio para demostraciones.',true,'Zona Franca, Cádiz','https://example.com'),
    (v_supplier_software,p_workspace_id,'Cloud Metrics Demo Ltd','EU000000003','billing.cloud@example.com',null,'service',v_software_category,'Proveedor ficticio en USD.',true,'Dublin, Ireland','https://example.com');

  insert into public.products(id,owner_id,name,sku,category,base_unit,active,last_cost,previous_cost,cost_unit,last_supplier_id,last_purchase_date,sale_price,sales_tax_rate,invoice_description,ean)
  values
    (v_product_cups,p_workspace_id,'Vaso kraft 240 ml','DEMO-VASO-240','Vasos','ud',true,0.071,0.069,'ud',v_supplier_goods,current_date-12,0.16,21,'Vaso kraft 240 ml','8400000000001'),
    (v_product_film,p_workspace_id,'Film alimentario 45 cm','DEMO-FILM-45','Film','rollo',true,3.15,3.05,'rollo',v_supplier_goods,current_date-8,7.95,21,'Film alimentario 45 cm','8400000000002'),
    (v_product_bags,p_workspace_id,'Bolsa camiseta 40x50','DEMO-BOLSA-4050','Bolsas','ud',true,0.031,0.030,'ud',v_supplier_goods,current_date-5,0.075,21,'Bolsa camiseta 40x50','8400000000003'),
    (v_product_tubs,p_workspace_id,'Tarrina salsa 60 ml','DEMO-TARRINA-60','Tarrinas','ud',true,0.052,0.049,'ud',v_supplier_goods,current_date-3,0.13,21,'Tarrina salsa 60 ml','8400000000004');

  insert into public.clients(id,owner_id,name,tax_id,email,phone,address_line1,postal_code,city,province,country_code,payment_terms_days,notes,active,default_vat_rate,default_payment_method)
  values
    (v_client_restaurant,p_workspace_id,'Restaurante La Marina Demo','B11010001','compras.marina@example.com','600000111','Paseo Marítimo 8','11010','Cádiz','Cádiz','ES',30,'Cliente ficticio.',true,21,'transfer'),
    (v_client_fruit,p_workspace_id,'Frutas del Sur Demo','B41010002','pedidos.frutas@example.com','600000112','Calle Mercado 14','41001','Sevilla','Sevilla','ES',15,'Cliente ficticio.',true,21,'card'),
    (v_client_catering,p_workspace_id,'Catering Costa Demo','B29010003','administracion.catering@example.com','600000113','Avenida del Puerto 31','29002','Málaga','Málaga','ES',30,'Cliente ficticio.',true,21,'transfer');

  insert into public.invoices(
    id,owner_id,supplier_id,invoice_number,issue_date,received_date,fiscal_year,fiscal_quarter,currency,net_amount,tax_amount,withholding_amount,
    total_amount,expense_category_id,status,source,extraction,extraction_confidence,notes,equivalence_surcharge_amount,payment_status,paid_at
  ) values
    (v_purchase_1,p_workspace_id,v_supplier_goods,'DEMO-COMP-001',current_date-35,current_date-34,extract(year from current_date-35)::int,extract(quarter from current_date-35)::int,'EUR',824.00,173.04,0,997.04,v_merchandise_category,'accounted','manual','{"demo":true}'::jsonb,1,'Factura ficticia.',0,'paid',current_date-25),
    (v_purchase_2,p_workspace_id,v_supplier_logistics,'DEMO-LOG-014',current_date-12,current_date-11,extract(year from current_date-12)::int,extract(quarter from current_date-12)::int,'EUR',186.00,39.06,0,225.06,v_transport_category,'reviewed','manual','{"demo":true}'::jsonb,1,'Factura ficticia pendiente de pago.',0,'unpaid',null),
    (v_purchase_3,p_workspace_id,v_supplier_software,'DEMO-SAA-089',current_date-7,current_date-7,extract(year from current_date-7)::int,extract(quarter from current_date-7)::int,'USD',49.00,0,0,49.00,v_software_category,'accounted','manual','{"demo":true,"reverse_charge":true}'::jsonb,1,'Servicio SaaS ficticio en USD.',0,'paid',current_date-7);

  insert into public.invoice_lines(owner_id,invoice_id,product_id,description,supplier_sku,quantity,unit,units_per_purchase,unit_price,normalized_unit_price,line_net,tax_rate,tax_amount,line_total,ai_confidence,price_update_status)
  values
    (p_workspace_id,v_purchase_1,v_product_cups,'Vaso kraft 240 ml','VASO-K240',6000,'ud',1,0.071,0.071,426.00,21,89.46,515.46,1,'confirmed'),
    (p_workspace_id,v_purchase_1,v_product_bags,'Bolsa camiseta 40x50','BOL-4050',10000,'ud',1,0.031,0.031,310.00,21,65.10,375.10,1,'confirmed'),
    (p_workspace_id,v_purchase_1,v_product_tubs,'Tarrina salsa 60 ml','TAR-60',1692.3077,'ud',1,0.052,0.052,88.00,21,18.48,106.48,1,'confirmed'),
    (p_workspace_id,v_purchase_2,null,'Servicio transporte nacional',null,1,'servicio',1,186,186,186,21,39.06,225.06,1,'pending'),
    (p_workspace_id,v_purchase_3,null,'Suscripción analítica mensual',null,1,'mes',1,49,49,49,0,0,49,1,'pending');

  insert into public.sales_invoice_series(id,owner_id,code,name,kind,year,prefix,next_number,padding,active)
  values(v_sales_series,p_workspace_id,'DEMO','Serie Demo','standard',v_year,'D-'||v_year||'-',3,4,true);

  insert into public.sales_invoices(
    id,owner_id,client_id,series_id,invoice_type,invoice_number,status,issue_date,due_date,currency,subtotal,discount_amount,tax_amount,total_amount,
    payment_method,notes,client_name,client_tax_id,client_email,client_phone,client_address,issuer_name,issuer_tax_id,issuer_email,issuer_phone,issuer_address,
    issued_at,sent_at,paid_at,reserved_number,document_kind,fiscal_treatment
  ) values
    (v_sale_1,p_workspace_id,v_client_restaurant,v_sales_series,'standard','D-'||v_year||'-0001','paid',current_date-20,current_date+10,'EUR',412.00,0,86.52,498.52,'transfer','Venta ficticia.',
      'Restaurante La Marina Demo','B11010001','compras.marina@example.com','600000111','Paseo Marítimo 8, Cádiz','Comercial Bahía Demo SL','B12345678','administracion@example.com','600000000','Avenida del Comercio 24, Cádiz',
      v_now-interval '20 days',v_now-interval '20 days',v_now-interval '12 days',1,'invoice','taxable'),
    (v_sale_2,p_workspace_id,v_client_fruit,v_sales_series,'standard','D-'||v_year||'-0002','sent',current_date-4,current_date+26,'EUR',286.00,0,60.06,346.06,'transfer','Venta ficticia pendiente.',
      'Frutas del Sur Demo','B41010002','pedidos.frutas@example.com','600000112','Calle Mercado 14, Sevilla','Comercial Bahía Demo SL','B12345678','administracion@example.com','600000000','Avenida del Comercio 24, Cádiz',
      v_now-interval '4 days',v_now-interval '4 days',null,2,'invoice','taxable');

  insert into public.sales_invoice_lines(owner_id,invoice_id,product_id,position,description,quantity,unit,unit_price,discount_percent,tax_rate,line_net,tax_amount,line_total)
  values
    (p_workspace_id,v_sale_1,v_product_film,1,'Film alimentario 45 cm',30,'rollo',7.95,0,21,238.50,50.085,288.585),
    (p_workspace_id,v_sale_1,v_product_tubs,2,'Tarrina salsa 60 ml',1334.6154,'ud',0.13,0,21,173.50,36.435,209.935),
    (p_workspace_id,v_sale_2,v_product_cups,1,'Vaso kraft 240 ml',1000,'ud',0.16,0,21,160.00,33.60,193.60),
    (p_workspace_id,v_sale_2,v_product_bags,2,'Bolsa camiseta 40x50',1680,'ud',0.075,0,21,126.00,26.46,152.46);

  insert into public.fulfillment_orders(
    owner_id,sendcloud_id,order_id,order_number,integration_id,integration_name,integration_type,source_channel,source_status,
    order_created_at,order_updated_at,customer_name,customer_email,customer_phone,shipping_address,billing_address,items,total_amount,currency,raw_payload,
    tracking_number,tracking_url,label_created_at,fulfilled_at,last_synced_at,carrier_code,carrier_name,shipping_service_name,tracking_status_code,tracking_status_message,
    shipping_cost_amount,shipping_cost_currency,shipping_cost_source,shipping_cost_net_amount,shipping_cost_tax_amount,shipping_cost_recorded_at
  ) values
    (p_workspace_id,'demo-order-1001','AMZ-DEMO-1001','DEMO-1001',900001,'Amazon Demo','amazon','amazon','shipped',v_now-interval '8 days',v_now-interval '7 days','Laura Martín','laura.martin@example.com','600100001',
      '{"street":"Calle Sol 10","city":"Sevilla","postal_code":"41001","country":"ES"}','{}',
      '[{"sku":"DEMO-FILM-45","name":"Film alimentario 45 cm","quantity":2}]',15.90,'EUR','{"demo":true}',
      'DEMO-TRK-1001','https://example.com/tracking/demo-1001',v_now-interval '7 days',v_now-interval '7 days',v_now,'ctt','CTT Express','24H','delivered','Entregado',4.20,'EUR','demo',3.47,0.73,v_now-interval '7 days'),
    (p_workspace_id,'demo-order-1002','WEB-DEMO-1002','DEMO-1002',900002,'Web Demo','shop','other','pending',v_now-interval '1 day',v_now-interval '1 day','Miguel Ruiz','miguel.ruiz@example.com','600100002',
      '{"street":"Avenida Andalucía 22","city":"Málaga","postal_code":"29002","country":"ES"}','{}',
      '[{"sku":"DEMO-VASO-240","name":"Vaso kraft 240 ml","quantity":500},{"sku":"DEMO-TARRINA-60","name":"Tarrina salsa 60 ml","quantity":500}]',145.00,'EUR','{"demo":true}',
      null,null,null,null,v_now,null,null,null,null,'Pendiente de preparar',null,null,null,null,null,null),
    (p_workspace_id,'demo-order-1003','AMZ-DEMO-1003','DEMO-1003',900001,'Amazon Demo','amazon','amazon','unshipped',v_now-interval '3 hours',v_now-interval '2 hours','Ana López','ana.lopez@example.com','600100003',
      '{"street":"Calle Real 5","city":"Cádiz","postal_code":"11001","country":"ES"}','{}',
      '[{"sku":"DEMO-BOLSA-4050","name":"Bolsa camiseta 40x50","quantity":1000}]',75.00,'EUR','{"demo":true}',
      null,null,null,null,v_now,null,null,null,null,'Pendiente de etiqueta',null,null,null,null,null,null);

  insert into public.amazon_accounts(id,owner_id,seller_id,display_name,region,status,initial_sync_from,last_successful_sync_at)
  values(v_amazon_account,p_workspace_id,'A-DEMO-ZENVIA','Amazon Europe · Demo','EU','disabled',v_now-interval '90 days',v_now-interval '1 hour');

  insert into public.amazon_orders(
    owner_id,amazon_account_id,amazon_order_id,marketplace_id,purchase_date,last_update_date,order_status,fulfillment_channel,sales_channel,currency_code,
    gross_sales,vat_amount,shipping_amount,promotion_discount,order_total,synced_at,programs,is_business_order
  ) values
    (p_workspace_id,v_amazon_account,'404-DEMO-0000001','A1RKKUPIHCS9HS',v_now-interval '8 days',v_now-interval '7 days','Shipped','MFN','Amazon.es','EUR',15.90,2.76,0,0,15.90,v_now,'{}',false),
    (p_workspace_id,v_amazon_account,'404-DEMO-0000002','A1RKKUPIHCS9HS',v_now-interval '2 days',v_now-interval '1 day','Unshipped','MFN','Amazon.es','EUR',75.00,13.02,0,0,75.00,v_now,'{}',true),
    (p_workspace_id,v_amazon_account,'171-DEMO-0000003','A13V1IB3VIYZZH',v_now-interval '5 days',v_now-interval '4 days','Shipped','AFN','Amazon.fr','EUR',34.90,5.82,0,0,34.90,v_now,'{}',false);

  insert into public.amazon_order_items(
    owner_id,amazon_account_id,amazon_order_id,marketplace_id,order_item_id,asin,seller_sku,quantity_ordered,quantity_shipped,item_price,item_tax,shipping_price,shipping_tax,promotion_discount,currency_code,synced_at
  ) values
    (p_workspace_id,v_amazon_account,'404-DEMO-0000001','A1RKKUPIHCS9HS','DEMO-ITEM-1','B0DEMOFILM1','DEMO-FILM-45',2,2,15.90,2.76,0,0,0,'EUR',v_now),
    (p_workspace_id,v_amazon_account,'404-DEMO-0000002','A1RKKUPIHCS9HS','DEMO-ITEM-2','B0DEMOBAGS1','DEMO-BOLSA-4050',1,0,75.00,13.02,0,0,0,'EUR',v_now),
    (p_workspace_id,v_amazon_account,'171-DEMO-0000003','A13V1IB3VIYZZH','DEMO-ITEM-3','B0DEMOCUPS1','DEMO-VASO-240',1,1,34.90,5.82,0,0,0,'EUR',v_now);

  update public.app_settings
  set config=jsonb_set(
        coalesce(config,'{}'::jsonb),
        '{demo}',
        jsonb_build_object(
          'enabled',true,
          'scenario','commerce_full',
          'scenario_version',1,
          'last_reset_at',v_now,
          'external_actions_disabled',true
        ),
        true
      ),
      updated_at=v_now
  where owner_id=p_workspace_id;

  return jsonb_build_object(
    'ok',true,
    'workspaceId',p_workspace_id,
    'scenario','commerce_full',
    'scenarioVersion',1,
    'resetAt',v_now,
    'counts',jsonb_build_object(
      'products',4,'clients',3,'suppliers',3,'purchaseInvoices',3,'salesInvoices',2,'fulfillmentOrders',3,'amazonOrders',3
    )
  );
end;
$$;

revoke all on function public.platform_reset_demo_workspace(uuid) from public,anon,authenticated;
grant execute on function public.platform_reset_demo_workspace(uuid) to service_role;

comment on function public.platform_reset_demo_workspace(uuid) is
  'Destructive demo-only reset. Requires app_settings.config.demo.enabled=true and replaces only data scoped to the supplied workspace.';

notify pgrst,'reload schema';
