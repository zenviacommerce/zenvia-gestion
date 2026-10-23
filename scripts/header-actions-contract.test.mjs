import test from 'node:test';import assert from 'node:assert/strict';
import {assertHeaderActionsPreserved} from './header-actions-contract.mjs';
test('fails a design migration that drops the preexisting transport-tariff action',()=>{
 assert.throws(()=>assertHeaderActionsPreserved(['Informes de recogida','Tarifas de transporte','Impresión directa'],['Informes de recogida','Impresión directa'],'Pedidos'),/Pedidos: missing header action\(s\): Tarifas de transporte/);
});
test('accepts retained actions and additions without accepting a lost duplicate',()=>{
 assert.doesNotThrow(()=>assertHeaderActionsPreserved(['Importar facturas','Exportar (32)'],['Exportar (32)',' Importar  facturas ','Nuevo']));
 assert.throws(()=>assertHeaderActionsPreserved(['Actualizar','Actualizar'],['Actualizar']),/Actualizar/);
});

test('accepts only the approved native-text to accessible shared-search migration',async()=>{
 const {normalizeListSearchControls}=await import('./header-actions-contract.mjs');
 const old={tag:'INPUT',placeholder:'Buscar cliente…',type:null,label:null,text:'',disabled:false};
 const shared={...old,type:'search',label:'Buscar cliente…'};
 assert.deepEqual(normalizeListSearchControls([old]),normalizeListSearchControls([shared]));
 for(const changed of [{...shared,disabled:true},{...shared,label:'Otra acción'},{...shared,type:'password'}])assert.notDeepEqual(normalizeListSearchControls([old]),normalizeListSearchControls([changed]));
 assert.notDeepEqual(normalizeListSearchControls([old]),normalizeListSearchControls([]));
 const date={tag:'INPUT',placeholder:'',type:'date',label:'Desde',text:'',disabled:false};assert.notDeepEqual(normalizeListSearchControls([date]),normalizeListSearchControls([{...date,type:'search'}]));
});
