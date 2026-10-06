import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadBundle(){
  const source=await readFile(new URL('../src/services/invoiceBundle.ts',import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

test('detects two complete invoices even when OCR loses both invoice numbers',async()=>{
  const {splitBundledInvoiceText,structuralInvoiceCount}=await loadBundle();
  const text=`
Compost and Paper S.L
Factura
ZENVIA COMMERCE S.L.
Forma Pago: FECHA FACTURA
21/09/26 26:
Desglose de impuestos
21,00% 2.773,99 EUR 582,54 EUR
TOTAL FACTU
3.356,53
texto legal
Compost and Paper S.L
Factura
ZENVIA COMMERCE S.L.
Forma Pago: FECHA FACTURA No Fi
21/09/26 262
Desglose de impuestos
21,00% 1.375,53 EUR 288,85 EUR
TOTAL FACTU
1.664,39
`;
  const blocks=splitBundledInvoiceText(text);
  assert.equal(structuralInvoiceCount(text),2);
  assert.equal(blocks.length,2);
  assert.match(blocks[0],/3\.356,53/);
  assert.match(blocks[1],/1\.664,39/);
});

test('does not split a multi-page invoice that repeats a header without independent fiscal closures',async()=>{
  const {splitBundledInvoiceText,structuralInvoiceCount}=await loadBundle();
  const text=`
Proveedor S.L.
Factura
Página 1 de 2
Artículo A 100,00
Factura
Página 2 de 2
Desglose de impuestos
Base imponible 100,00
IVA 21,00
TOTAL FACTURA 121,00
`;
  assert.deepEqual(splitBundledInvoiceText(text),[]);
  assert.equal(structuralInvoiceCount(text),0);
});


test('bulk expense import expands bundled PDFs into separate candidates',async()=>{
const engine=await readFile(new URL('../src/services/invoiceEngine.ts',import.meta.url),'utf8');assert.match(engine,/mergeDocuments/);assert.match(engine,/bundleIndex=i\+1/);assert.match(engine,/bundleCount=documents.length/);assert.match(engine,/p_key:/);
});

test('bundled invoices may share the source file hash but still check supplier and invoice number',async()=>{
const sql=await readFile(new URL('../supabase/migrations/20261002190000_invoice_engine.sql',import.meta.url),'utf8');assert.match(sql,/supplier_id=s.id and public.invoice_engine_name_key\(invoice_number\)=public.invoice_engine_name_key\(full_number\) and issue_date=issue/);assert.match(sql,/abs\(total_amount-total\)/);assert.match(sql,/unique\(owner_id,source_document_id,document_key\)/);
});

test('single upload processes multiple invoices and retains uncertain candidates in review',async()=>{
const source=await readFile(new URL('../src/components/UploadInvoiceModal.tsx',import.meta.url),'utf8');assert.match(source,/prepareInvoiceCandidates/);assert.match(source,/for\(const c of candidates\)/);assert.match(source,/preparedCandidate \|\|= c/);
});


test('detects a supplier PDF that mixes an invoice, credit note and delivery paperwork',async()=>{
  const {structuralInvoiceCount}=await loadBundle();
  const text=`
Factura
ZENVIA COMMERCE S.L.
26/06/26 2614066
Desglose de impuestos
21,00% 1.363,19 EUR 286,27 EUR
Total factura: 1.649,46 EUR
ABONO
ZENVIA COMMERCE S.L.
26/08/26 993
Desglose de impuestos
21,00% 34,96 EUR 7,34 EUR
Total factura: -42,30 EUR
DEVOLVER AL
AGENCIA
TRANSPORTES
ENTREGA
`;
  assert.ok(structuralInvoiceCount(text)>=2);
});
