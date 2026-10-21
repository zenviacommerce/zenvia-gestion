import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
async function core(){const source=await readFile(new URL('../src/services/shopifyInvoiceCore.ts',import.meta.url),'utf8').catch(()=> 'export function shopifyInvoiceLines(){return []}');return import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`)}
const money=amount=>({shopMoney:{amount:String(amount),currencyCode:'EUR'}});
function order(included=true){return {taxesIncluded:included,totalPriceSet:money(included?27.83:33.6743),lineItems:{nodes:[{name:'Producto',quantity:2,originalUnitPriceSet:money(12.1),discountAllocations:[{allocatedAmountSet:money(2.42)}],taxLines:[{rate:.21,priceSet:money(included?3.78:4.5738)}]}]},shippingLines:{nodes:[{title:'Envío',discountedPriceSet:money(6.05),taxLines:[{rate:.21,priceSet:money(included?1.05:1.2705)}]}]}}}
test('Shopify invoice preserves allocated discounts, included tax and shipping',async()=>{const {shopifyInvoiceLines}=await core();const lines=shopifyInvoiceLines(order());assert.equal(lines.length,2);assert.equal(lines[0].quantity,2);assert.equal(lines[0].unitPrice,9);assert.equal(lines[0].taxRate,21);assert.equal(lines[1].unitPrice,5);});
test('tax-exclusive Shopify prices are not divided by VAT',async()=>{const {shopifyInvoiceLines}=await core();const lines=shopifyInvoiceLines(order(false));assert.equal(lines[0].unitPrice,10.89);assert.equal(lines[1].unitPrice,6.05);});
test('missing fiscal details require resync instead of assuming Spanish VAT',async()=>{const {shopifyInvoiceLines}=await core();assert.throws(()=>shopifyInvoiceLines({lineItems:{nodes:[]}}),/Actualizar/);});
test('incomplete lines and refunded orders never produce a partial invoice',async()=>{const {shopifyInvoiceLines}=await core();assert.throws(()=>shopifyInvoiceLines({...order(),lineItems:{...order().lineItems,pageInfo:{hasNextPage:true}}}),/líneas/);assert.throws(()=>shopifyInvoiceLines({...order(),displayFinancialStatus:'PARTIALLY_REFUNDED'}),/reembols/);});
test('a different invoice total is blocked before consuming a number',async()=>{const {shopifyInvoiceLines}=await core();assert.throws(()=>shopifyInvoiceLines({...order(),totalPriceSet:money(99)}),/cuadra/);});
test('sanitized real fiscal shapes #1020–#1025 preserve Shopify totals and exact tax cents including discounts',async()=>{
 const {shopifyInvoiceLines}=await core();
 const fixtures=JSON.parse(await readFile(new URL('../tests/fixtures/shopify-invoice-fiscal-1020-1025.json',import.meta.url),'utf8'));
 for(const {orderNumber,payload} of fixtures){
  const lines=shopifyInvoiceLines(payload),source=[...payload.lineItems.nodes,...payload.shippingLines.nodes];
  assert.equal(Math.round(lines.reduce((sum,l)=>sum+l.lineTotal,0)*100),Math.round(Number(payload.totalPriceSet.shopMoney.amount)*100),orderNumber);
  assert.deepEqual(lines.map(l=>Math.round(l.taxAmount*100)),source.map(l=>Math.round(l.taxLines.reduce((sum,t)=>sum+Number(t.priceSet.shopMoney.amount),0)*100)),orderNumber+' preserves actual VAT cents');
 }
});
