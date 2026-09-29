import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import test from 'node:test';

const root=new URL('../src/',import.meta.url);

async function walk(dir){
  const entries=await readdir(dir,{withFileTypes:true});
  const files=[];
  for(const entry of entries){
    const full=join(dir,entry.name);
    if(entry.isDirectory())files.push(...await walk(full));
    else if(extname(entry.name)==='.tsx')files.push(full);
  }
  return files;
}

test('every data table uses the shared sortable-column primitive',async()=>{
  const files=await walk(root.pathname);
  const tables=[];
  for(const file of files){
    const source=await readFile(file,'utf8');
    if(/<table\b/.test(source))tables.push({file:relative(root.pathname,file),source});
  }
  assert.ok(tables.length>=10,'expected the application data tables to be discovered');
  for(const table of tables){
    assert.match(table.source,/SortableTableHeader/,table.file+' must expose generic asc/desc sorting');
  }
});

test('shared table sorting is stable, persisted per list and null-safe',async()=>{
  const source=await readFile(new URL('../src/components/SortableTableHeader.tsx',import.meta.url),'utf8');
  assert.match(source,/zenvia:table-sort:/);
  assert.match(source,/Intl\.Collator\('es'/);
  assert.match(source,/left\.index-right\.index/);
  assert.match(source,/if\(av\.empty\)return 1/);
  assert.match(source,/current\.direction==='asc'\?'desc':'asc'/);
  assert.match(source,/aria-sort/);
});

test('core operational lists sort before pagination or rendering',async()=>{
  const files=[
    'pages/Invoices.tsx','pages/Clients.tsx','pages/Products.tsx','pages/Suppliers.tsx',
    'pages/Orders.tsx','pages/SalesInvoicesCore.tsx',
  ];
  for(const file of files){
    const source=await readFile(new URL('../src/'+file,import.meta.url),'utf8');
    assert.match(source,/useSortableTable\(/,file+' should use the shared sorter');
    assert.match(source,/sorting\.rows|sortedOrders|sortedInvoices/,file+' should render sorted rows');
  }
});
