import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function analyze(response,deterministicDate=''){
  const source=await readFile(new URL('../src/services/invoiceIntelligence.ts',import.meta.url),'utf8');
  const mocked=source.replace("import { supabase } from './supabase';",`const supabase={functions:{invoke:async()=>(${JSON.stringify(response)})}};`);
  const js=ts.transpileModule(mocked,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  const {analyzeInvoiceWithIntelligence}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  return analyzeInvoiceWithIntelligence(undefined,{invoiceDate:deterministicDate,invoiceNumber:'INV-1',supplierName:'Supplier Ltd',subtotal:100,vat:21,total:121,confidence:.8,text:'Document evidence',lines:[]},'expense');
}
const verified=(date,supported=true)=>({data:{ok:true,extraction:{issueDate:date,dueDate:date,issuer:{},recipient:{},confidence:.9,amounts:{},lines:[]},verification:{support:{issueDate:supported,dueDate:supported},fiscalConsistent:false,verifiedLines:[],warnings:[]}}});

test('evidence-supported AI dates fill missing deterministic issue and due dates',async()=>{
  const result=await analyze(verified('2026-08-03'));
  assert.equal(result.invoiceDate,'2026-08-03');
  assert.equal(result.aiDueDate,'2026-08-03');
});
test('AI date adoption rejects unsupported claims and impossible calendar days',async()=>{
  for(const response of [verified('2026-08-03',false),verified('2026-02-30'),verified('2026-13-01'),verified('03/08/2026')]){
    const result=await analyze(response,'2026-07-31');
    assert.equal(result.invoiceDate,'2026-07-31');
    assert.equal(result.aiDueDate,undefined);
  }
});
test('AI outage preserves deterministic date without inventing a missing date',async()=>{
  for(const date of ['2026-07-31','']){
    const result=await analyze({error:{message:'offline'}},date);
    assert.equal(result.invoiceDate,date);
    assert.equal(result.analysisEngine,'deterministic');
  }
});
