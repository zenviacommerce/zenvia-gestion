import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
async function files(dir){const all=[];for(const d of await readdir(dir,{withFileTypes:true})){const p=join(dir,d.name);if(d.isDirectory())all.push(...await files(p));else if(p.endsWith('.tsx'))all.push(p)}return all}
test('every existing sortable table wires the common reset control and state machine',async()=>{
 const consumers=[];
 for(const path of await files('src')){
  const s=await readFile(path,'utf8');if(path.endsWith('/SortableTableHeader.tsx')||!s.includes('<SortableTableHeader'))continue;
  consumers.push(path);
  assert.match(s,/useSortableTable\(|useTableSort\(/,path+' uses shared three-state sorting');
  assert.match(s,/<TableSortReset\b|<DataTable\s+sorting=/,path+' must expose a reset outside its column headers');
  assert.doesNotMatch(s,/setSortDir\(/,path+' must not retain an independent two-state toggle');
 }
 assert.ok(consumers.includes('src/components/VerifactuIntegrityModal.tsx'),'include the new read-only integrity daily table in the audited inventory');
 assert.equal(consumers.length,15,'keep the audited sortable table inventory explicit');
});
