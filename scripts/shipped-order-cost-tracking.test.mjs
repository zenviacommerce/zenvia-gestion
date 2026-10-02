import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/services/orderShipping.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const shipping=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const order={carrierCode:'mrw',carrierName:'MRW',shippingProvider:'sendcloud',shippingServiceName:'MRW Mañana 19h',shippingOptionCode:'mrw:19h',sendcloudParcelId:123,weightKg:1,orderCreatedAt:'2026-10-01',shippingAddress:{country_code:'ES',postal_code:'43360'},trackingNumber:'01009F045384'};
const tariff={id:'tariff',status:'active',carrierCode:'mrw',carrierName:'MRW',shippingProvider:'mrw',effectiveFrom:'2026-01-01',pricesIncludeVat:false,fuelSurchargeIncluded:true,currencyCode:'EUR',services:[{canonicalServiceKey:'manana-19h',serviceName:'Mañana 19h',bands:[{countryCode:'ES',zoneCode:'peninsular',minWeightKg:0,maxWeightKg:2,basePrice:4}]}]};
test('shipped MRW order uses actual carrier and contract tariff across providers',()=>{assert.equal(shipping.calculateDefaultShippingPreview(order,[tariff],'correos')?.totalAmount,4.84)});
test('unknown dispatched service does not get the default 19h price',()=>{const second={...tariff.services[0],canonicalServiceKey:'manana-10h',serviceName:'Mañana 10h'};assert.equal(shipping.calculateDefaultShippingPreview({...order,shippingServiceName:'unknown',shippingOptionCode:'unknown'},[{...tariff,services:[...tariff.services,second]}],'mrw'),null)});
test('recorded provider cost retains priority',()=>{assert.equal(shipping.shippingPriceForOrder({...order,shippingCostAmount:8}, {totalAmount:4.84})?.totalAmount,8)});
test('tracking preserves provider link for every carrier',()=>{assert.equal(shipping.trackingUrlForOrder({...order,trackingUrl:'https://carrier.example/track/123'}),'https://carrier.example/track/123')});
test('legacy Sendcloud shipment opens the actual carrier website',()=>{assert.equal(new URL(shipping.trackingUrlForOrder(order)).hostname,'www.mrw.es')});
test('tracking does not generate an empty or unsafe URL',()=>{assert.equal(shipping.trackingUrlForOrder({...order,trackingNumber:null,trackingUrl:'javascript:alert(1)'}),null)});

test('Envia Correos shipment opens Correos with its tracking number',()=>{
 const url=new URL(shipping.trackingUrlForOrder({...order,shippingProvider:'envia',carrierCode:'correos',carrierName:'Correos',trackingUrl:'https://envia.com/es-ES/tracking?label=123'}));
 assert.equal(url.hostname,'www.correos.es');assert.equal(url.searchParams.get('numero'),order.trackingNumber);
});
test('Envia MRW shipment does not open Envia or Sendcloud',()=>{assert.equal(new URL(shipping.trackingUrlForOrder({...order,shippingProvider:'envia',trackingUrl:'https://envia.com/es-ES/tracking'})).hostname,'www.mrw.es')});
test('Correos Express must not be routed to Correos postal tracking',()=>{assert.equal(new URL(shipping.trackingUrlForOrder({...order,shippingProvider:'envia',carrierCode:'correosexpress',carrierName:'Correos Express'})).hostname,'s.correosexpress.com')});
test('carrier-provided deep links are retained for Envia shipments',()=>{const link='https://www.mrw.es/seguimiento/envio.asp?code=123';assert.equal(shipping.trackingUrlForOrder({...order,shippingProvider:'envia',trackingUrl:link}),link)});
test('unknown carrier never falls back to an aggregator page',()=>{assert.equal(shipping.trackingUrlForOrder({...order,shippingProvider:'envia',carrierCode:'unknown',carrierName:'Unknown',trackingUrl:'https://envia.com/es-ES/tracking'}),null)});
