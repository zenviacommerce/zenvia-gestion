import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
test('bridge removes archives and migrated Gmail records without exposing config',async()=>{
 const src=await readFile(new URL('../supabase/functions/_shared/platformIntegrations.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
 const {customerIntegrationSummary}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
 const rows=[{id:'live',enabled:true,status:'connected',config:{oauthStateHash:'private'}},{id:'old',enabled:true,status:'connected',config:{archivedAt:'date'}},{id:'gmail',provider:'gmail',enabled:true,status:'connected',config:{migratedToAccountId:'live'}},{id:'off',enabled:false,status:'disabled'},{id:'error',enabled:true,status:'error'}];
 const result=customerIntegrationSummary(rows);
 assert.deepEqual(result.map(x=>x.id),['live','error']);
 assert.equal('config' in result[0],false);
});
test('bridge accepts Shopify customer permissions',async()=>{
 const src=await readFile(new URL('../supabase/functions/platform-bridge/index.ts',import.meta.url),'utf8');
 assert.match(src.match(/const modulePermissions=([^;]+)/)[1],/'shopify'/);
});
