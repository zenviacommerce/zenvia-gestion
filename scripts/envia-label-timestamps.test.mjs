import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const edge=await readFile(new URL('../supabase/functions/envia-shipping/index.ts',import.meta.url),'utf8');
const source=edge.slice(edge.indexOf('function shipmentCreatedAt('),edge.indexOf('function shipmentDestination('));
const compiled=await transform(source,{loader:'ts',format:'cjs'});
const {shipmentCreatedAt}=new Function('clean',`${compiled.code}; return {shipmentCreatedAt};`)(value=>String(value??'').trim());
test('Envia history wall clock uses its UTC-6 offset, not runtime UTC',()=>{
  assert.equal(shipmentCreatedAt({created_at:'2026-10-14 03:17:29'}),'2026-10-14T09:17:29.000Z');
});
test('explicit Envia offsets are respected without another correction',()=>{
  assert.equal(shipmentCreatedAt({created_at:'2026-10-14T03:17:29-06:00'}),'2026-10-14T09:17:29.000Z');
  assert.equal(shipmentCreatedAt({created_at:'2026-10-14T09:17:29Z'}),'2026-10-14T09:17:29.000Z');
});
test('Envia clock rolls into the next UTC day and is independent of Spanish DST',()=>{
  assert.equal(shipmentCreatedAt({created_at:'2026-01-31 23:59:59'}),'2026-02-01T05:59:59.000Z');
});
test('missing or invalid history date never invents a creation date',()=>{
  assert.equal(shipmentCreatedAt({}),null);
  assert.equal(shipmentCreatedAt({created_at:'invalid'}),null);
});
test('sync preserves known label creation and cost timestamps',()=>{
  assert.match(edge,/label_created_at:existing\?\.label_created_at\|\|createdAt/);
  assert.match(edge,/shipping_cost_recorded_at:price==null\?null:existing\?\.shipping_cost_recorded_at\|\|createdAt/);
});
