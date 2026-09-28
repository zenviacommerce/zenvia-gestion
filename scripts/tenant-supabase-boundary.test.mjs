import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../src/',import.meta.url));

async function files(dir){
  const entries=await readdir(dir,{withFileTypes:true});
  const out=[];
  for(const entry of entries){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await files(path));
    else if(/\.(ts|tsx)$/.test(entry.name))out.push(path);
  }
  return out;
}

test('only tenantSupabase creates Supabase clients and no legacy customer project is hardcoded in src',async()=>{
  const paths=await files(root);
  for(const path of paths){
    const source=await readFile(path,'utf8');
    const rel=relative(root,path).replaceAll('\\','/');
    if(rel!=='services/tenantSupabase.ts'){
      assert.doesNotMatch(source,/\bcreateClient\s*\(/,'Direct createClient in '+rel);
    }
    assert.doesNotMatch(source,/sjkxxbedkkmgmqnvaqjh/,'Legacy project hardcoded in '+rel);
    assert.doesNotMatch(source,/VITE_SUPABASE_URL/,'Fixed Supabase URL environment dependency in '+rel);
    assert.doesNotMatch(source,/VITE_SUPABASE_PUBLISHABLE_KEY/,'Fixed Supabase key environment dependency in '+rel);
  }
});

test('business services continue through the active Supabase facade',async()=>{
  const source=await readFile(new URL('../src/services/supabase.ts',import.meta.url),'utf8');
  assert.match(source,/new Proxy/);
  assert.match(source,/getActiveSupabase/);
  assert.match(source,/getTenantSupabase/);
});
