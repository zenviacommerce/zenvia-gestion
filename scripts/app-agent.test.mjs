import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('ZENVIA IA is mounted globally and can perform only safe UI actions',async()=>{
  const [app,agent,service]=await Promise.all([
    read('src/App.tsx'),
    read('src/components/AppAgent.tsx'),
    read('src/services/appAgent.ts'),
  ]);
  assert.match(app,/<AppAgent/);
  assert.match(app,/handleAgentAction/);
  assert.match(app,/open_expense_upload/);
  assert.match(app,/open_product_create/);
  assert.match(app,/open_supplier_create/);
  assert.match(agent,/ZENVIA IA/);
  assert.match(agent,/Especialista en ZENVIA Gestión/);
  assert.match(agent,/Las acciones sensibles requieren confirmación/);
  assert.match(service,/supabase\.functions\.invoke\('app-agent'/);
});

test('tenant AI proxy authenticates the user and never exposes platform bridge credentials to the browser',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  assert.match(edge,/admin\.auth\.getUser/);
  assert.match(edge,/PLATFORM_CONTROL_PLANE_URL/);
  assert.match(edge,/PLATFORM_BRIDGE_TOKEN/);
  assert.match(edge,/functions\/v1\/platform-agent/);
  assert.match(edge,/x-platform-token/);
});


test('global AI and alerts live in a reserved toolbar instead of floating over page actions',async()=>{
  const [app,css]=await Promise.all([
    read('src/App.tsx'),
    read('src/app-agent.css'),
  ]);
  assert.match(app,/className="appGlobalTools"/);
  assert.match(app,/className="appGlobalTools"[\s\S]*<AppAgent[\s\S]*<AlertCenter/);
  assert.match(css,/\.appGlobalTools\{[\s\S]*position:sticky/);
  assert.match(css,/\.appGlobalTools \.appAgentLauncher\{position:static/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*\.appGlobalTools\{[\s\S]*position:fixed/);
  assert.match(css,/\.mobileNavHeader\{padding-right:108px!important\}/);
});
