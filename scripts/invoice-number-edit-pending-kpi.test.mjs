import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('invoice number is proposed and editable inside the create/edit invoice modal',()=>{
  const page=read('src/pages/SalesInvoicesCore.tsx');
  const main=read('src/main.tsx');
  assert.match(page,/updateSalesInvoiceNumber/,'invoice modal must use the invoice-number update service');
  assert.match(page,/\[invoiceNumber,setInvoiceNumber\]/,'invoice modal must keep the editable number in modal state');
  assert.match(page,/Número de factura/,'invoice modal must show a Número de factura field');
  assert.match(page,/prefix.*nextNumber|nextNumber.*prefix/s,'invoice modal must propose the next number from the selected series');
  assert.match(page,/setInvoiceNumber\(e\.target\.value\)/,'invoice number field must be directly editable');
  assert.doesNotMatch(main,/SalesInvoiceNumberEditor/,'there must not be a separate invoice-numbering button/manager');
});

test('saving a draft persists the chosen number and issuance preserves it',()=>{
  const page=read('src/pages/SalesInvoicesCore.tsx');
  const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>/invoice_number/i.test(name));
  assert.ok(migrations.length>0,'an invoice-number migration must exist');
  const sql=migrations.map(name=>read(`supabase/migrations/${name}`)).join('\n');
  assert.match(page,/updateSalesInvoiceNumber\([^,]+,invoiceNumber\.trim\(\)\)/,'modal save must persist the chosen invoice number');
  assert.match(sql,/Ya existe una factura con el número/i,'RPC must reject duplicate numbers');
  assert.match(sql,/next_number/i,'manual numbers ahead of the sequence must advance next_number');
  assert.match(sql,/audit_logs/i,'renumbering must be audited');
  assert.match(sql,/coalesce\(trim\(v_invoice\.invoice_number\),'\s*'\)<>''/,'issuing a draft must preserve a manually assigned number');
});

test('StatCard preserves the dashboard warning for pending KPI cards and actions',async()=>{
  const bundle=await build({entryPoints:['src/components/StatCard.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime']});
  const module={exports:{}};runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url)});
  const {StatCard}=module.exports;
  for(const onClick of [undefined,()=>{}]){
    const html=renderToStaticMarkup(createElement(StatCard,{label:'Pendientes',value:'2',icon:null,variant:'warning',onClick}));
    assert.match(html,/class="[^"]*dashboardPendingOrders/,'warning must survive card/action rendering');
  }
  const neutral=renderToStaticMarkup(createElement(StatCard,{label:'Pendientes',value:'0',icon:null}));
  assert.doesNotMatch(neutral,/dashboardPendingOrders/,'default KPI must stay neutral');
});
