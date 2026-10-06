import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Envia rate parsing keeps carrier and service identities separate',async()=>{
  const edge=await read('supabase/functions/envia-shipping/index.ts');
  assert.match(edge,/carrierDescription/);
  assert.match(edge,/serviceDescription/);
  assert.doesNotMatch(edge,/function carrierName\(item:any\)\{return clean\(item\?\.description/);
  assert.match(edge,/parseEtaDays/);
});

test('Envia label response supports documented data arrays and trackUrl',async()=>{
  const edge=await read('supabase/functions/envia-shipping/index.ts');
  assert.match(edge,/const rows=asRows\(payload\)/);
  const trackingSource=await read('supabase/functions/_shared/shipmentTracking.ts');
  const output=ts.transpileModule(trackingSource,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  const {trackingCandidates}=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  assert.deepEqual(trackingCandidates({data:[{trackUrl:'https://carrier.example/track/000123'}]}),['https://carrier.example/track/000123']);
  assert.match(edge,/data\?\.totalPrice/);
});

test('Envia shipments are synchronized independently from Sendcloud',async()=>{
  const [edge,orders,page]=await Promise.all([
    read('supabase/functions/envia-shipping/index.ts'),
    read('src/services/orders.ts'),
    read('src/pages/Orders.tsx'),
  ]);
  assert.match(edge,/action==='sync_shipments'/);
  assert.match(edge,/\/guide\/\$\{period\.month\}\/\$\{period\.year\}/);
  assert.match(orders,/syncEnviaShipments/);
  assert.match(page,/syncEnviaShipments/);
  assert.match(page,/Envia\.com/);
});

test('live quote comparison shows final price, source, carrier and service',async()=>{
  const [page,shipping]=await Promise.all([
    read('src/pages/Orders.tsx'),
    read('src/services/orderShipping.ts'),
  ]);
  assert.match(page,/ordersComparison/);
  assert.match(page,/Precio final/);
  assert.match(page,/Origen del precio/);
  assert.match(page,/IVA y combustible incluidos/);
  assert.match(page,/ordersProviderBadge/);
  assert.match(shipping,/estimateTransportTariffForOption/);
  assert.match(shipping,/externalServiceCode/);
});

test('generic tariff fallback never interprets VAT percentage as fuel surcharge',async()=>{
  const tariff=await read('src/services/transportTariffs.ts');
  assert.match(tariff,/iva\|vat\|impuesto/);
  assert.match(tariff,/reanalyzeTransportTariffDraft/);
});

test('unusable tariff imports are explicit and cannot be reviewed as empty tariffs',async()=>{
  const panel=await read('src/components/TransportTariffsPanel.tsx');
  assert.match(panel,/La importación no contiene servicios ni tramos/);
  assert.match(panel,/Reanalizar/);
  assert.match(panel,/La tarifa no contiene servicios y tramos utilizables/);
});


test('tariff fallback does not invent expiry or fuel inclusion from unrelated document text',async()=>{
  const tariff=await read('src/services/transportTariffs.ts');
  assert.doesNotMatch(tariff,/\|\|text\.match\(\/\(\\d\{1,2\}\)/);
  assert.match(tariff,/fuelSurchargeIncluded:fuelIncluded/);
  assert.match(tariff,/No se ha podido determinar el tratamiento del combustible/);
});


test('Envia quotes sanitize state values and retain per-carrier compatibility fallback',async()=>{
  const edge=await read('supabase/functions/envia-shipping/index.ts');
  assert.match(edge,/function enviaStateCode/);
  assert.match(edge,/\^\[A-Z0-9\]\{2\}\$/);
  assert.match(edge,/delete normalized\.state/);
  assert.match(edge,/geocodeRows/);
  assert.match(edge,/geocodes\.envia\.com\/locate/);
  assert.match(edge,/if\(!origin\.state\)throw new Error/);
  assert.match(edge,/shipment:\{type:1\}/);
  assert.match(edge,/Envia all-carrier quote fallback/);
  assert.match(edge,/if\(enabled\.length\)options=options\.filter/);
  assert.match(edge,/shipment:\{type:1,carrier\}/);
});


test('tariff imports retain their provider metadata while estimates match carrier contracts',async()=>{
  const [shipping,tariffs,panel,migration]=await Promise.all([
    read('src/services/orderShipping.ts'),
    read('src/services/transportTariffs.ts'),
    read('src/components/TransportTariffsPanel.tsx'),
    read('supabase/migrations/20261001001500_transport_tariff_shipping_provider.sql'),
  ]);
  assert.match(tariffs,/shippingProvider:TransportShippingProvider/);
  assert.match(tariffs,/shipping_provider:shippingProvider/);
  assert.match(shipping,/carrierCandidates/);
  assert.match(shipping,/if\(!providerMatch\)return -1/);
  assert.match(panel,/Aplicar en/);
  assert.match(panel,/Sendcloud/);
  assert.match(panel,/Envia\.com/);
  assert.match(migration,/shipping_provider in \('sendcloud','envia'\)/);
  assert.match(migration,/shipping_provider=v_document\.shipping_provider/);
});


test('Envia history backfill is independent from Sendcloud history state',async()=>{
  const [orders,page]=await Promise.all([
    read('src/services/orders.ts'),
    read('src/pages/Orders.tsx'),
  ]);
  assert.match(orders,/ENVIA_HISTORY_SYNC_KEY='zenvia-envia-history-sync'/);
  assert.match(orders,/shouldRunEnviaHistorySync/);
  assert.match(orders,/markEnviaHistorySyncDone/);
  assert.match(page,/syncEnviaShipments\(enviaHistory\?12:2\)/);
  assert.match(page,/markEnviaHistorySyncDone\(\)/);
  assert.match(page,/shouldRunEnviaHistorySync\(\)/);
});


test('Sendcloud V3 shipping-options request includes route fields so quotes can be calculated',async()=>{
  const edge=await read('supabase/functions/sendcloud-order-tools/index.ts');
  assert.match(edge,/from_address:fromAddress/);
  assert.match(edge,/to_address:toAddress/);
  assert.match(edge,/country_code:fromCountry/);
  assert.match(edge,/postal_code:fromPostal/);
  assert.match(edge,/calculate_quotes:true/);
  assert.match(edge,/dimensions:/);
});

test('label modal restores a preferred selection and explicit create action',async()=>{
  const [page,css]=await Promise.all([read('src/pages/Orders.tsx'),read('src/orders.css')]);
  assert.match(page,/preferredOption=\{automaticShippingOption\(labelOrder,options\)\}/);
  assert.match(page,/const \[selectedKey,setSelectedKey\]/);
  assert.match(page,/Predeterminada/);
  assert.match(page,/Crear etiqueta/);
  assert.match(page,/disabled=\{loading\|\|!selected\}/);
  assert.match(css,/ordersComparisonRow\.selected/);
  assert.match(page,/Number\(option\.price\)>0/,'zero-cost placeholders must not become the cheapest priced recommendation');
});


test('Sendcloud unstamped zero-cost placeholder is excluded from parcel comparison',async()=>{
  const orders=await read('src/services/orders.ts');
  assert.match(orders,/Number\(option\.price\)===0/);
  assert.match(orders,/unstamped\|sin franqueo\|unfranked/);
});


test('Sendcloud falls back to v2 rate APIs when v3 options contain no quote',async()=>{
  const edge=await read('supabase/functions/sendcloud-order-tools/index.ts');
  assert.match(edge,/enrichSendcloudPrices/);
  assert.match(edge,/api\/v2\/shipping_methods/);
  assert.match(edge,/api\/v2\/shipping-price/);
  assert.match(edge,/v2MethodScore/);
});


test('Envia geocoder reads the real Spain response shape',async()=>{
  const edge=await read('supabase/functions/envia-shipping/index.ts');
  assert.match(edge,/state\?\.code\?\.\['2digit'\]/);
  assert.match(edge,/value\.zip_code/);
  assert.match(edge,/row\.country\?\.code/);
  assert.match(edge,/value\.locality/);
});


test('contracted tariff estimates compare carrier contracts across aggregators and direct MRW',async()=>{
  const code=await read('src/services/orderShipping.ts');
  const output=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  const {estimateTransportTariffForOption:estimate}=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  const order={weightKg:1,orderCreatedAt:'2026-10-01',shippingAddress:{country_code:'ES',postal_code:'28001'}};
  const document={id:'contract',status:'active',shippingProvider:'envia',carrierCode:'mrw',carrierName:'MRW',currencyCode:'EUR',pricesIncludeVat:false,fuelSurchargeIncluded:true,services:[{serviceName:'Mañana 19h',externalProvider:'mrw',externalServiceCode:'manana-19h',bands:[{countryCode:'ES',zoneCode:'peninsular',minWeightKg:0,maxWeightKg:5,basePrice:5}]}]};
  const option={provider:'sendcloud',carrierCode:'mrw',carrierName:'MRW',code:'manana-19h',name:'Mañana 19h'};
  assert.equal(estimate(order,[document],option).totalAmount,6.05,'Carrier contracts can be compared through Sendcloud');
  assert.equal(estimate(order,[{...document,shippingProvider:'sendcloud'}],{...option,provider:'envia'}).totalAmount,6.05,'Carrier contracts can be compared through Envia');
  assert.equal(estimate(order,[document],{...option,provider:'envia'}).totalAmount,6.05);
  assert.equal(estimate(order,[document],{...option,provider:'mrw',code:'0205',name:'MRW 19'}).totalAmount,6.05);
  assert.equal(estimate(order,[document],{...option,provider:'mrw',carrierCode:'seur',carrierName:'SEUR'}),null,'MRW exception still requires a matching carrier');
});
