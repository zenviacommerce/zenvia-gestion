import {describe,it,expect} from 'vitest';
import {transportKpisWithTariffs} from '../src/services/orderShipping';
import type {FulfillmentOrder,OrdersDashboardKpis} from '../src/services/orders';
import type {TransportTariffDocument} from '../src/services/transportTariffs';
const baseline=(changes={})=>({total:10,net:10,tax:0,mrw:10,correos:0,other:0,shipments:58,valued:51,missing:7,basis:'recorded_only',...changes} as OrdersDashboardKpis['transport']);
const order=(changes={})=>({id:'off-page',shippingAddress:{country_code:'ES',postal_code:'28001'},weightKg:1,orderCreatedAt:'2026-07-01',labelCreatedAt:'2026-07-02',carrierCode:'mrw',carrierName:'MRW',shippingServiceName:'19',shippingOptionCode:'0205',shippingCostAmount:null,kpiCarrierLabel:'mrw',...changes} as FulfillmentOrder & {kpiCarrierLabel:string});
const tariffs=[{id:'tariff',status:'active',carrierCode:'mrw',carrierName:'MRW',currencyCode:'EUR',pricesIncludeVat:true,fuelSurchargeIncluded:true,services:[{serviceName:'19',bands:[{countryCode:'ES',zoneCode:'peninsular',minWeightKg:0,maxWeightKg:5,basePrice:5}]}]}] as TransportTariffDocument[];
describe('full-scope transport tariff reconciliation',()=>{
 it('values off-page candidates without requiring list rows or changing shipments',()=>{const result=transportKpisWithTariffs(baseline(),Array.from({length:7},(_,i)=>order({id:String(i)})),tariffs);expect(result.total).toBe(45);expect(result.valued).toBe(58);expect(result.missing).toBe(0);expect(result.shipments).toBe(58)});
 it('replaces a persisted estimate rather than double counting it',()=>{const result=transportKpisWithTariffs(baseline(),[order({shippingCostAmount:10,shippingCostSource:'tariff_estimate'})],tariffs);expect(result.total).toBe(5);expect(result.net).toBeCloseTo(4.13);expect(result.mrw).toBe(5);expect(result.valued).toBe(51)});
 it('keeps a persisted estimate if no tariff matches',()=>{expect(transportKpisWithTariffs(baseline(),[order({shippingCostAmount:10,shippingCostSource:'tariff_estimate'})],[]).total).toBe(10)});
 it('preserves actual recorded amounts over tariff previews',()=>{expect(transportKpisWithTariffs(baseline(),[order({shippingCostAmount:10,shippingCostSource:'provider'})],tariffs).total).toBe(10)});
 it('does not include a non-EUR preview and removes a replaced EUR estimate',()=>{const usd=tariffs.map(t=>({...t,currencyCode:'USD'}));const result=transportKpisWithTariffs(baseline(),[order({shippingCostAmount:10,shippingCostSource:'tariff_estimate'})],usd);expect(result.total).toBe(0);expect(result.missing).toBe(8)});
 it('can replace a non-EUR stored estimate with an EUR tariff without subtracting it',()=>{const result=transportKpisWithTariffs(baseline(),[order({shippingCostAmount:10,shippingCostCurrency:'USD',shippingCostSource:'tariff_estimate'})],tariffs);expect(result.total).toBe(15);expect(result.valued).toBe(52)});
});
