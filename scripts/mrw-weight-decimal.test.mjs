import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=readFileSync(new URL('../supabase/functions/mrw-shipping/index.ts',import.meta.url),'utf8');
const expressions=[...source.matchAll(/<Peso>\$\{([^}]+)\}<\/Peso>/g)].map(m=>m[1]);
test('MRW receives decimal kilograms for both parcel and shipment',()=>{
 assert.equal(expressions.length,2);
 for(const weight of [2.3,0.89,1,40])for(const expression of expressions){
  const transmitted=vm.runInNewContext(expression,{weight});
  const received=Number(transmitted.replaceAll('.','').replace(',','.'));
  assert.equal(received,weight,`${weight} kg became ${received} kg via ${transmitted}`);
 }
});
