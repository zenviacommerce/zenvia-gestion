import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('all managed integration accounts expose a confirmed delete action even when disconnected',async()=>{
 const [page,api]=await Promise.all([read('src/pages/Settings.tsx'),read('src/services/integrationAccounts.ts')]);
 assert.match(page,/const removeAccount=async\(account:IntegrationAccount\)/);
 assert.match(page,/title:'Eliminar integración'/);
 assert.match(page,/confirmLabel:'Eliminar integración'/);
 assert.match(page,/await deleteIntegrationAccount\(account\.id\)/);
 assert.match(page,/!account\.legacy&&<button[^>]*onClick=\{\(\)=>void removeAccount\(account\)\}/);
 assert.doesNotMatch(page,/account\.status!=='disabled'&&!account\.legacy&&<button[^>]+removeAccount/);
 assert.match(api,/export async function deleteIntegrationAccount\(id:string\)/);
 assert.match(api,/action:'delete',id/);
});

test('account deletion archives by owner and preserves historical links and other integrations',async()=>{
 const edge=await read('supabase/functions/integration-accounts/index.ts');
 assert.match(edge,/if\(action==='delete'\)/);
 assert.match(edge,/enabled:false,status:'disabled',is_default:false/);
 assert.match(edge,/archivedAt:now/);
 assert.match(edge,/\.eq\('id',id\)\.eq\('owner_id',caller\.data_owner_id\)/);
 assert.match(edge,/if\(children\?\.length\)throw new Error/);
 assert.match(edge,/writeVault\(admin,account\.id,account\.provider,/);
 assert.match(edge,/revoked:true,revokedAt:now/);
 assert.match(edge,/if\(wasDefault\)/);
 assert.match(edge,/if\(account\.provider==='amazon'&&account\.linked_resource_id\)/);
 assert.match(edge,/!account\.config\?\.archivedAt/);
 assert.doesNotMatch(edge,/if\(action==='delete'\)[\s\S]{0,2800}\.delete\(\)/);
});

test('adding back a removed integration reuses archived account identity and clears archive marker',async()=>{
 const edge=await read('supabase/functions/integration-accounts/index.ts');
 assert.match(edge,/existing\.data\?\.config\?\.archivedAt/);
 assert.match(edge,/\.eq\('id',existing\.data\.id\)/);
 assert.match(edge,/delete restoredConfig\.archivedAt/);
 assert.match(edge,/oauthStateHash:stateHash/);
 assert.match(edge,/if\(!data\|\|data\.config\?\.archivedAt\)throw new Error/);
});
