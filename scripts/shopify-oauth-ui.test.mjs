import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Shopify multi-store installation is OAuth-first and never requires a pasted token',async()=>{
 const [page,client]=await Promise.all([read('src/pages/Settings.tsx'),read('src/services/integrationAccounts.ts')]);
 assert.match(page,/shopifyOAuthConfiguration\(\)/);
 assert.match(page,/beginShopifyAuthorization\(shopifyDomain\.trim\(\),syncOrders/);
 assert.match(page,/provider==='shopify'&&!shopifyManualMode/);
 assert.match(page,/Continuar con Shopify/);
 assert.match(page,/Opciones avanzadas · conectar con token antiguo/);
 assert.match(client,/action:'shopify_oauth_start'/);
 assert.match(client,/action:'shopify_oauth_exchange'/);
 assert.match(client,/action:'shopify_config'/);
 assert.match(client,/action:'shopify_app_setup'/);
 assert.doesNotMatch(client,/\baccessToken:\s*shopifyAccessToken/);
});

test('OAuth callback code is immediately erased from the browser URL, then exchanged after login',async()=>{
 const [capture,app]=await Promise.all([read('src/services/shopifyOAuthCallback.ts'),read('src/App.tsx')]);
 assert.match(capture,/history\.replaceState/);
 assert.match(capture,/['"]code['"],['"]hmac['"],['"]shop['"],['"]state['"]/);
 assert.match(capture,/let pendingQuery:string\|null=null/);
 assert.doesNotMatch(capture,/localStorage\./);
 assert.match(app,/completeShopifyAuthorization\(query\)/);
 assert.match(app,/shopifyOAuthExchangeStarted\.current=true/);
 assert.match(app,/setSettingsInitialSection\('integrations'\)/);
 assert.match(app,/window\.dispatchEvent\(new Event\('zenvia:shopify-connected'\)\)/);
});

test('legacy Shopify tokens stay optional and saved only to the original vault-backed backend',async()=>{
 const [page,client]=await Promise.all([read('src/pages/Settings.tsx'),read('src/services/integrationAccounts.ts')]);
 assert.match(page,/shopifyManualMode&&<label className="settingsField"/);
 assert.match(page,/shopifyAccessToken\.trim\(\)/);
 assert.match(client,/functionErrorMessage/);
});
