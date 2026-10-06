import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('document errors remain visible in the persistent history',async()=>{
  const ui=await read('../src/components/PersistentImports.tsx');assert.match(ui,/item.error/);assert.match(ui,/Reintentar incidencias/);assert.match(ui,/Completar manualmente/);
});

test('document submission always clears the local upload indicator',async()=>{
  const source=await read('../src/components/PersistentImports.tsx');assert.match(source,/finally\{setBusy\(false\)/);
});
