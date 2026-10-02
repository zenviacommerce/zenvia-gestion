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

test('tracking preserves recorded links for a carrier unknown to the application',()=>{assert.equal(shipping.trackingUrlForOrder({...order,carrierCode:'future-carrier',trackingUrl:'https://future-carrier.example/track/opaque'}),'https://future-carrier.example/track/opaque')});
test('resolved carrier links take priority over branded provider URLs',()=>{assert.equal(shipping.trackingUrlForOrder({...order,trackingUrl:'https://envia.com/tracking',carrierTrackingUrl:'https://future-carrier.example/track/opaque'}),'https://future-carrier.example/track/opaque')});
test('recorded carrier forwarding links remain available before backend deployment',()=>{const link='https://tracking.sendcloud.sc/forward?code=000123&carrier=future-carrier';assert.equal(shipping.trackingUrlForOrder({...order,trackingUrl:link}),link)});
test('branded provider pages still request server resolution',()=>{assert.equal(shipping.trackingUrlForOrder({...order,shippingProvider:'envia',trackingUrl:'https://envia.com/tracking'}),null)});
test('a tracking number alone never generates an invented URL',()=>{assert.equal(shipping.trackingUrlForOrder({...order,trackingUrl:null}),null)});
test('unsafe URLs are not exposed by the drawer',()=>{assert.equal(shipping.trackingUrlForOrder({...order,trackingUrl:'javascript:alert(1)'}),null)});
