import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/pages/Orders.tsx',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('  const existingLabel=async'),source.indexOf('  const generateLabels=async'));
for(const mode of ['print','download'])test(`successful ${mode} records label delivery and refreshes state`,async()=>{
 const events=[];const order={id:'shopify-1018'};
 const context=vm.createContext({setBusyOrder:()=>{},fetchOrderLabel:async()=>({}),labelBlob:()=>({}),handleBlob:async()=>events.push('delivered'),markOrderLabelPrinted:async id=>events.push(`saved:${id}`),refresh:async()=>{events.push('refresh');return [order]},setOrders:()=>{},setSelected:()=>{},showError:()=>{},errorMessage:()=>''});
 vm.runInContext(ts.transpile(handler+';globalThis.run=existingLabel;'),context);
 await context.run(order,mode);assert.deepEqual(events,['delivered','saved:shopify-1018','refresh']);
});
test('failed PDF delivery does not mark the label as printed',async()=>{
 let saved=false;
 const context=vm.createContext({setBusyOrder:()=>{},fetchOrderLabel:async()=>({}),labelBlob:()=>({}),handleBlob:async()=>{throw Error('PDF failure')},markOrderLabelPrinted:async()=>{saved=true},showError:()=>{},errorMessage:()=>''});
 vm.runInContext(ts.transpile(handler+';globalThis.run=existingLabel;'),context);
 await context.run({id:'shopify-1018'},'download');assert.equal(saved,false);
});
