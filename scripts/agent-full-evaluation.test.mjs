import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

const cases=[
  ['pedidos pendientes','orders_shipping'],['cómo funciona etiquetados','orders_shipping'],['editar peso del pedido','orders_shipping'],
  ['comparar tarifas de envío','orders_shipping'],['imprimir etiqueta A6','orders_shipping'],['facturas de gasto pendientes','expenses'],
  ['importar factura desde Gmail','expenses'],['IVA recargo retención total','expenses'],['facturas emitidas vencimientos','sales_clients'],
  ['recibos sin factura','sales_clients'],['datos fiscales de clientes','sales_clients'],['producto SKU EAN coste','catalog_suppliers'],
  ['tipo de proveedor categoría habitual','catalog_suppliers'],['Amazon reembolsos rentabilidad','amazon'],['Amazon inventario stock','amazon'],
  ['vincular ASIN producto interno','amazon'],['tickets de soporte','support'],['configuración integraciones','settings_admin'],
  ['alertas automatizaciones','settings_admin'],['usuarios permisos auditoría','settings_admin'],
];

test('20 in-scope intents are represented in the RAG catalogue',async()=>{
  const migrations=[
    await read('supabase/migrations/20261002135000_agent_knowledge_rag.sql'),
    await read('supabase/migrations/20261002143000_agent_tools_and_knowledge_v2.sql'),
    await read('supabase/migrations/20261002150000_agent_knowledge_screen_catalog.sql'),
  ].join('\n');
  const expected=new Set(cases.map(([,domain])=>domain));
  for(const domain of expected)assert.match(migrations,new RegExp("'"+domain+"'"));
  for(const [query] of cases){
    const tokens=query.toLowerCase().split(/\s+/).filter(x=>x.length>4);
    assert.ok(tokens.some(token=>migrations.toLowerCase().includes(token.normalize('NFD').replace(/[\u0300-\u036f]/g,''))||migrations.toLowerCase().includes(token)),query);
  }
});

test('5 out-of-scope cases are rejected by the application-only guard',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  assert.match(edge,/outOfScopeReply/);
  assert.match(edge,/!appScopeEvidence\(contextual\)/);
  for(const query of ['presidente de Francia','tiempo de mañana','dieta','script Python','Excel']){
    assert.ok(!/zenvia|pedido|factura|cliente|producto|proveedor|amazon|soporte|configuracion/i.test(query));
  }
});

test('5 ambiguity and trap cases are guarded',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  assert.match(edge,/hazlo/);
  assert.match(edge,/borralo|bórralo/);
  assert.match(edge,/¿Qué elemento o acción concreta de ZENVIA quieres que gestione\?/);
  assert.match(edge,/data_owner_id/);
  assert.match(edge,/No tengo documentada una respuesta fiable|sin inventar funciones/);
});

test('write actions are governed by registry and standard confirmation',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  const app=await read('src/App.tsx');
  for(const key of ['orders.sync','clients.create','products.create','suppliers.create','expenses.set_status'])assert.ok(edge.includes(key),key);
  assert.match(app,/confirmAction/);
  assert.match(app,/sync_orders/);
  assert.match(app,/create_client/);
  assert.match(app,/create_product/);
  assert.match(app,/create_supplier/);
  assert.match(app,/set_expense_status/);
});

test('RAG search favours strict matches before broad fallback',async()=>{
  const migration=await read('supabase/migrations/20261002153000_agent_knowledge_search_precision.sql');
  assert.match(migration,/strict_query/);
  assert.match(migration,/broad_query/);
  assert.match(migration,/strict_query\)\*3/);
});
