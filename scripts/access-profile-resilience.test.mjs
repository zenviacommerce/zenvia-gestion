import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('access profile retries once after auth/session errors',async()=>{
  const source=await read('src/services/access.ts');
  assert.match(source,/fetchAccessProfileRow/);
  assert.match(source,/supabase\.auth\.getSession\(\)/);
  assert.match(source,/supabase\.auth\.refreshSession\(\)/);
  assert.match(source,/result=await withDataApiRetry\(\(\)=>fetchAccessProfileRow\(userId\)/);
});

test('access errors surface PostgREST details instead of a generic blank failure',async()=>{
  const source=await read('src/services/access.ts');
  assert.match(source,/accessErrorMessage/);
  assert.match(source,/Código/);
  assert.match(source,/details/);
  assert.match(source,/hint/);
  assert.match(source,/throw new Error\(accessErrorMessage\(result\.error\)\)/);
});


test('access profile tolerates a temporary PostgREST schema-cache outage',async()=>{
  const source=await read('src/services/access.ts');
  const app=await read('src/App.tsx');
  assert.match(source,/isTransientDataApiError/);
  assert.match(source,/PGRST001/);
  assert.match(source,/PGRST002/);
  assert.match(source,/57014/);
  assert.match(source,/withDataApiRetry/);
  assert.match(source,/attempts=15/);
  assert.match(app,/loadAccessAndBranding\(userId\),90000/);
  assert.match(app,/loadAccessAndBranding\(session\.user\.id\),90000/);
});
