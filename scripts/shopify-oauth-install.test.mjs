import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Shopify OAuth never asks the shopper to type an access token by default',async()=>{
  const [screen,api]=await Promise.all([read('src/pages/Settings.tsx'),read('src/services/integrationAccounts.ts')]);
  assert.match(screen,/beginShopifyAuthorization\(shopifyDomain\.trim\(\),syncOrders\)/);
  assert.match(screen,/provider==='shopify'&&!shopifyManualMode/);
  assert.match(screen,/Continuar con Shopify/);
  assert.match(screen,/Configuración avanzada · usar token manual/);
  assert.match(api,/supabase\.functions\.invoke\('shopify-oauth'/);
  assert.match(api,/\/admin\/oauth\/authorize/);
});

test('callback is HMAC-signed, one time, owner scoped and stores credentials in Vault',async()=>{
  const [edge,ddl,shared]=await Promise.all([
    read('supabase/functions/shopify-oauth/index.ts'),
    read('supabase/migrations/20261012145000_shopify_oauth_states.sql'),
    read('supabase/functions/_shared/shopifyOAuth.ts'),
  ]);
  for(const source of ['crypto.subtle.sign','crypto.subtle.importKey','state_hash','consumed_at','owner_id','shop_domain','expires_at','read_orders','admin/oauth/access_token']){
    assert.ok(edge.includes(source),source);
  }
  assert.match(edge,/\.is\('consumed_at',null\)/);
  assert.match(edge,/\.gt\('expires_at',now\)/);
  assert.match(edge,/normalizeShopifyDomain\(params\.get\('shop'\)\)/);
  assert.match(edge,/credential_source:'vault'/);
  assert.match(ddl,/revoke all on public\.shopify_oauth_states from anon, authenticated, public/);
  assert.match(shared,/integration_store_secret/);
  assert.match(shared,/integration_read_secret/);
  assert.doesNotMatch(edge,/returnToApp\([^)]*access_token/i);
});

test('new Shopify installations can refresh expiring offline access tokens while manual connections remain intact',async()=>{
  const [shared,integration,orders]=await Promise.all([
    read('supabase/functions/_shared/shopifyOAuth.ts'),
    read('supabase/functions/integration-accounts/index.ts'),
    read('supabase/functions/shopify-orders/index.ts'),
  ]);
  assert.match(shared,/grant_type:'refresh_token'/);
  assert.match(shared,/expiresAt-120000/);
  assert.match(shared,/tokenPayload\(await res\.json\(\),stored,shopDomain\)/);
  assert.match(shared,/if\(expiresAt&&Date\.now\(\)>=expiresAt-120000\)/);
  assert.match(integration,/activeShopifyCredentials\(admin,account\)/);
  assert.match(orders,/activeShopifyCredentials\(admin,account\)/);
});
