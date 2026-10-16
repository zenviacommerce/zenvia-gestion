import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

async function walk(dir){
  const entries=await readdir(new URL(dir,root),{withFileTypes:true});
  const out=[];
  for(const entry of entries){
    const path=`${dir.replace(/\/$/,'')}/${entry.name}`;
    if(entry.isDirectory())out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

test('workspace-owned foreign keys migrate from auth.users to workspaces',async()=>{
  const sql=await read('supabase/migrations/20260925163500_tenant_isolation_hardening.sql');
  assert.match(sql,/column_name in \('owner_id','workspace_owner_id'\)/);
  assert.match(sql,/ref\.relname='users'/);
  assert.match(sql,/references public\.workspaces\(id\)/i);
  assert.match(sql,/validate constraint/i);
  assert.match(sql,/allow_environment_credentials boolean not null default false/i);
});

test('environment credentials require an explicitly grandfathered workspace',async()=>{
  const [sql,accounts,sendcloudOrders,sendcloudTools,amazonStatus]=await Promise.all([
    read('supabase/migrations/20260925163500_tenant_isolation_hardening.sql'),
    read('supabase/functions/integration-accounts/index.ts'),
    read('supabase/functions/sendcloud-orders/index.ts'),
    read('supabase/functions/sendcloud-order-tools/index.ts'),
    read('supabase/functions/amazon-status/index.ts'),
  ]);
  assert.match(sql,/enforce_environment_integration_scope/);
  assert.match(sql,/allow_environment_credentials=true/);
  assert.doesNotMatch(accounts,/ensureEnvironmentBackedAccounts/);
  assert.doesNotMatch(sendcloudOrders,/return \{id:null,displayName:'Sendcloud',credentialSource:'environment'/);
  assert.doesNotMatch(sendcloudTools,/return env;/);
  assert.doesNotMatch(amazonStatus,/\(!integration&&envConfigured\)/);
});

test('Amazon seller credentials are scoped by workspace while app credentials may be shared',async()=>{
  const config=await read('supabase/functions/_shared/amazon/config.ts');
  assert.match(config,/ownerId:string/);
  assert.match(config,/integration_amazon_credential_snapshot/);
  assert.match(config,/row.owner_id!==ownerId/);
  assert.match(config,/appKey==='private_v1'/);
  assert.match(config,/AMAZON_LEGACY_FALLBACK_ACCOUNT_ID/);
  assert.match(config,/allowedId===row.integration_account_id/);
  assert.match(config,/readAmazonLwaApplication/);
  const snapshot=await read('supabase/migrations/20261016193505_amazon_app_credentials.sql');
  assert.match(snapshot,/i.owner_id=p_owner_id/);
  assert.match(snapshot,/a.integration_account_id=i.id and a.owner_id=i.owner_id/);


  const paths=(await walk('supabase/functions')).filter(path=>path.endsWith('.ts')&&!path.endsWith('/config.ts'));
  for(const path of paths){
    const source=await read(path);
    const calls=[...source.matchAll(/loadAmazonSpApiCredentials\(admin,\{([^}]*)\}\)/g)];
    for(const call of calls){
      assert.match(call[1],/\bownerId\b/,`${path} must pass ownerId when loading Amazon credentials`);
    }
  }
});

test('new workspace onboarding initializes business identity and expense categories',async()=>{
  const platform=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(platform,/from\('business_settings'\)\.insert/);
  assert.match(platform,/legal_name:legalName\|\|name/);
  assert.match(platform,/from\('expense_categories'\)\.insert\(categories\)/);
  for(const category of ['Mercancía','Transporte y logística','Publicidad y marketing','Comisiones marketplaces','Otros']){
    assert.match(platform,new RegExp(category));
  }
});
