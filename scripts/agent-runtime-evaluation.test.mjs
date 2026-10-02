import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=(await readFile(new URL('../supabase/functions/app-agent/index.ts',import.meta.url),'utf8')).replace(/import \{ createClient \}[^;]+;/,'').split('Deno.serve(')[0];
const code=ts.transpileModule(source+'\nexport {processLocalAgent,authorizedPages,safeCount,safeRows};',{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {processLocalAgent,authorizedPages,safeCount,safeRows}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const allowed=['dashboard','orders','invoices','sales','clients','products','suppliers','amazon','support','settings','admin'];
const context={orders:{pending:1,total:2,recent:[{id:'order-a',order_number:'ORDER-A',customer_name:'Test',source_status:'pending'}]},expenses:{pendingReview:0,unpaid:1,paid:2,recent:[{id:'invoice-a',invoice_number:'INV-A',supplier_name:'Proveedor Test',status:'pending',payment_status:'unpaid',total_amount:21}]},products:{total:3,withoutCost:1,items:[{id:'product-a',name:'Producto Test',sku:'TEST',last_cost:null}]},clients:{total:4,items:[]},suppliers:{total:5,items:[]},sales:{open:6,recent:[]},support:{open:7,recent:[]},integrationAccounts:[{provider:'envia',label:'Test',enabled:true}],adminUsers:[{active:true}],audit:[{created_at:'2026-10-02',summary:'Cambió producto'}],tools:['orders.sync','clients.create','products.create','suppliers.create','expenses.set_status','expenses.set_payment','support.create','amazon.sync'].map(tool_key=>({tool_key}))};
const cases=[
 ['pending orders','cuántos pedidos pendientes tengo',/1 pedidos pendientes/],
 ['pending expenses','facturas de gasto pendientes',/0 facturas/],
 ['unpaid expenses','facturas de gasto por pagar',/1 facturas/],
 ['paid expenses','facturas de gasto pagadas',/2 facturas/],
 ['catalog count','cuántos productos',/3 productos/],
 ['missing cost','productos sin coste',/1 productos/],
 ['clients count','cuántos clientes',/4 clientes/],
 ['supplier count','cuántos proveedores',/5 proveedores/],
 ['sales outstanding','facturas emitidas pendientes',/6 facturas/],
 ['open support','tickets abiertos',/7 tickets/],
 ['connected integrations','integraciones conectadas',/envia/],
 ['workspace users','cuántos usuarios activos',/1 usuarios/],
 ['audit data','últimos cambios de auditoría',/Cambió producto/],
 ['screen grounded explanation','cómo comparar tarifas de envío',/documento exacto/],
 ['pending summary','qué tengo pendiente',/1 pedidos sin etiqueta/],
 ['navigation','llévame a Pedidos',null,'navigate'],
 ['prepare client','crea un cliente Nuevo Test',null,'create_client'],
 ['prepare supplier','crea un proveedor Nuevo Test',null,'create_supplier'],
 ['prepare product','crea un producto Nuevo Test',null,'create_product'],
 ['prepare payment','marca factura INV-A pagada',null,'set_expense_payment'],
];
for(const [name,query,pattern,action] of cases)test(name,()=>{const ctx=query.startsWith('cómo')?{...context,knowledge:[{content:'documento exacto de comparador',domain:'orders_shipping'}]}:context;const result=processLocalAgent(query,ctx,allowed,{currentPage:'dashboard'});if(pattern)assert.match(result.answer,pattern);if(action)assert.equal(result.action.type,action)});
for(const query of ['presidente de Francia','tiempo de mañana','dieta para adelgazar','escribe un script Python','haz un Excel'])test('out of scope: '+query,()=>{const r=processLocalAgent(query,context,allowed,{});assert.equal(r.action.type,'none');assert.match(r.answer,/Solo puedo ayudarte/)});
for(const [name,query,pages,ctx,expected] of [
 ['ambiguous payment','marca factura pagada',allowed,context,'none'],
 ['missing supplier name','crea un proveedor',allowed,context,'none'],
 ['no permission','sincroniza los pedidos',['dashboard'],context,'none'],
 ['disabled registry tool','sincroniza los pedidos',allowed,{...context,tools:[]},'none'],
 ['exact invoice required','contabiliza factura INV-Z',allowed,context,'none'],
])test(name,()=>assert.equal(processLocalAgent(query,ctx,pages,{}).action.type,expected));
test('server permissions cannot be raised by requested pages',()=>assert.deepEqual(authorizedPages({role:'user',permissions:['products']},['admin','products']),['products']));
test('query errors never become zero counts',async()=>{await assert.rejects(()=>safeCount(Promise.resolve({error:new Error('database unavailable')})));await assert.rejects(()=>safeRows(Promise.resolve({error:new Error('database unavailable')})))});
test('Amazon sync is a prepared action',()=>assert.equal(processLocalAgent('sincroniza Amazon',context,allowed,{}).action.type,'sync_amazon'));
test('support creation uses a real prepared action',()=>assert.equal(processLocalAgent('crea un ticket: Error de prueba; Descripción de prueba',context,allowed,{}).action.type,'create_support_ticket'));

test('bare action asks one clarification',()=>{const r=processLocalAgent('hazlo',context,allowed,{});assert.match(r.answer,/Qué elemento o acción concreta/);assert.equal(r.action.type,'none')});
