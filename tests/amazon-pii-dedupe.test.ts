import {afterEach,expect,it,vi} from 'vitest';
const network=vi.hoisted(()=>({rows:[] as Record<string,unknown>[]}));
vi.mock('../src/services/supabase',()=>{
 const client={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},order(){return this},limit(){return this},abortSignal:async()=>({data:network.rows,error:null})})};
 return {supabase:client,getActiveSupabase:()=>client};
});
import {listFulfillmentOrders} from '../src/services/orders';
import {trackingUrlForOrder} from '../src/services/orderShipping';
import type {FulfillmentOrder} from '../src/services/orders';
import {resetOrdersSnapshot} from '../src/services/ordersSnapshot';
afterEach(resetOrdersSnapshot);
const purged={id:'purged',sendcloud_id:'amazon:synthetic',order_number:'SYNTHETIC-DUPLICATE',source_channel:'amazon',source_status:'SHIPPED',source_integration_account_id:'synthetic-account',pii_purged_at:'2026-10-16T00:00:00Z',customer_name:null,customer_email:null,customer_phone:null,tracking_number:null,shipping_address:{},billing_address:{},items:[{sku:'SYN',quantity:1}],total_amount:24,currency:'EUR',last_synced_at:'2026-10-16T00:00:00Z'};
const legacy={...purged,id:'legacy',sendcloud_id:'1234',pii_purged_at:null,customer_name:'SYNTHETIC LEGACY BUYER',customer_email:'synthetic@example.invalid',customer_phone:'000000000',shipping_address:{name:'SYNTHETIC LEGACY BUYER',address_line_1:'SYNTHETIC LEGACY ADDRESS'},billing_address:{name:'SYNTHETIC LEGACY BUYER'},shipping_label_url:'https://example.invalid/label',tracking_url:'https://example.invalid/tracking',tracking_number:'SYNTHETIC-TRACK',tracking_metadata:{number:'SYNTHETIC-TRACK',url:'https://example.invalid/carrier'},sendcloud_parcel_id:123};
it.each([['marked first',[purged,legacy]],['marked last',[legacy,purged]]])('retains purge marker and cannot resurrect legacy duplicate PII (%s)',async(_name,rows)=>{network.rows=rows;const result=await listFulfillmentOrders();expect(result).toHaveLength(1);expect(result[0]).toMatchObject({piiPurgedAt:purged.pii_purged_at,customerName:null,customerEmail:null,customerPhone:null,shippingAddress:{},billingAddress:{},shippingLabelUrl:null,trackingUrl:null,carrierTrackingUrl:null,totalAmount:24});expect(JSON.stringify(result)).not.toContain('SYNTHETIC LEGACY');});
it('does not map retained provider URLs on an already marked row',async()=>{network.rows=[{...legacy,pii_purged_at:purged.pii_purged_at}];const [row]=await listFulfillmentOrders();expect(row).toMatchObject({customerName:null,customerEmail:null,customerPhone:null,shippingAddress:{},billingAddress:{}});expect(row.shippingLabelUrl).toBeNull();expect(row.trackingUrl).toBeNull();expect(row.carrierTrackingUrl).toBeNull();});

it('does not synthesize or return a tracking link for a purged order',()=>{expect(trackingUrlForOrder({piiPurgedAt:purged.pii_purged_at,trackingNumber:'SYNTHETIC-TRACK',carrierCode:'mrw',trackingUrl:'https://example.invalid/tracking'} as FulfillmentOrder)).toBeNull();});

it('maps retained destination country without reintroducing an address',async()=>{network.rows=[{...purged,destination_country_code:'ES'}];const [row]=await listFulfillmentOrders();expect(row).toMatchObject({destinationCountryCode:'ES',shippingAddress:{},billingAddress:{}});});
it('prefers marked row retained country over a stale duplicate country',async()=>{network.rows=[{...purged,destination_country_code:'ES'},{...legacy,destination_country_code:'FR'}];const [row]=await listFulfillmentOrders();expect(row.destinationCountryCode).toBe('ES');expect(row.shippingAddress).toEqual({});});
