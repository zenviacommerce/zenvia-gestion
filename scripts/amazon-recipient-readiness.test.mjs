import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function readiness(orders){
  const source=fs.readFileSync('supabase/functions/_shared/amazon/orders.ts','utf8');
  const match=source.match(/function operationalRecipientReadiness[\s\S]*?\n}\n/);
  assert.ok(match,'recipient readiness must inspect actual PII, not HTTP success');
  const code=match[0].replace(/:any\[\]/g,'').replace(/:any/g,'');
  return vm.runInNewContext(code+'\noperationalRecipientReadiness',{clean:v=>String(v??'').trim(),merchantFulfilled:o=>o?.fulfillment?.fulfilledBy==='MERCHANT'})(orders);
}
const order=address=>({fulfillment:{fulfilledBy:'MERCHANT',fulfillmentStatus:'UNSHIPPED'},recipient:{deliveryAddress:address}});
test('successful Amazon response with only public address data is not ready',()=>{
  assert.equal(readiness([order({city:'Guadix',postalCode:'18500',countryCode:'ES'})]),'pii_permission_missing');
});
test('name and street prove recipient access is available',()=>{
  assert.equal(readiness([order({name:'Customer',addressLine1:'Street'})]),'ready');
});
test('pending or shipped redaction does not invalidate recipient authorization',()=>{
  for(const fulfillmentStatus of ['PENDING','SHIPPED','CANCELLED']){
    assert.equal(readiness([{...order({}),fulfillment:{fulfilledBy:'MERCHANT',fulfillmentStatus}}]),null);
  }
  assert.equal(readiness([]),null);
});
