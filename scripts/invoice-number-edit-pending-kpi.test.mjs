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

test('invoice modal previews the series but assigns no editable fiscal number',()=>{
  const page=read('src/pages/SalesInvoicesCore.tsx');
  const main=read('src/main.tsx');
  assert.doesNotMatch(page,/updateSalesInvoiceNumber/);
  assert.doesNotMatch(page,/setInvoiceNumber/);
  assert.match(page,/prefix.*nextNumber|nextNumber.*prefix/s);
  assert.doesNotMatch(main,/SalesInvoiceNumberEditor/);
});

test('draft save leaves fiscal allocation to the transactional issuer',()=>{
  const page=read('src/pages/SalesInvoicesCore.tsx');
  const service=read('src/services/salesInvoiceNumber.ts');
  const sql=read('supabase/migrations/20261024075749_verifactu_shadow_phase1.sql');
  assert.doesNotMatch(page,/updateSalesInvoiceNumber\(/);
  assert.match(service,/no se puede cambiar manualmente|asigna.*emitir/i);
  assert.match(sql,/vf_allocate_number/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/VF_NUMBER_ASSIGNED_ON_ISSUE/);
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

