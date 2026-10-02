import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Gestion agent has strict application scope and grounded fallback',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  assert.match(edge,/appScopeEvidence/);
  assert.match(edge,/outOfScopeReply/);
  assert.match(edge,/Solo puedo ayudarte con ZENVIA Gestión/);
  assert.match(edge,/knowledgeAnswer/);
  assert.match(edge,/routeAgentDomain/);
  assert.match(edge,/No tengo documentada una respuesta fiable/);
});

test('Gestion agent keeps confirmation boundary for writes',async()=>{
  const app=await read('src/App.tsx');
  for(const action of ['sync_orders','create_client','create_product','create_supplier','set_expense_status']){
    assert.match(app,new RegExp(action));
  }
  assert.match(app,/confirmAction/);
});

test('Gestion agent documentation includes RAG metadata and 30 evaluation cases',async()=>{
  const doc=await read('docs/agent/ZENVIA_IA.md');
  assert.match(doc,/Base de conocimiento \/ RAG/);
  assert.match(doc,/requires_confirmation/);
  assert.match(doc,/## Batería de 30 pruebas/);
  for(let i=1;i<=30;i++)assert.match(doc,new RegExp('\\b'+i+'\\.'));
});
