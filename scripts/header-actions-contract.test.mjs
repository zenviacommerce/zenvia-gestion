import test from 'node:test';import assert from 'node:assert/strict';
import {assertHeaderActionsPreserved} from './header-actions-contract.mjs';
import {normalizeBillingIntegrityAddition} from './header-actions-contract.mjs';
test('accounts for exactly the declared billing integrity action without hiding lost or changed controls',()=>{
 const before=['Series','Datos fiscales','Nueva factura'];
 assert.deepEqual(normalizeBillingIntegrityAddition(before,['Integridad sombra',...before],'billing'),before);
 assert.notDeepEqual(normalizeBillingIntegrityAddition(before,['Integridad sombra',...before.slice(1)],'billing'),before);
 assert.notDeepEqual(normalizeBillingIntegrityAddition(before,['Integridad sombra',...before],'expenses'),before);
 assert.throws(()=>normalizeBillingIntegrityAddition(before,['Integridad sombra','Integridad sombra',...before],'billing'));
 const control={tag:'BUTTON',placeholder:null,text:'Integridad sombra',label:null,type:null,disabled:false};
 const existing={...control,text:'Series'};
 assert.deepEqual(normalizeBillingIntegrityAddition([existing],[control,existing],'billing'),[existing]);
 for(const changed of [{...control,disabled:true},{...control,type:'submit'},{...control,label:'Otra acción'}])assert.throws(()=>normalizeBillingIntegrityAddition([existing],[changed,existing],'billing'));
 assert.notDeepEqual(normalizeBillingIntegrityAddition([existing],[control,{...existing,disabled:true}],'billing'),[existing]);
});
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
 for(const changed of [{...shared,disabled:true},{...shared,label:'Otra acción'},{...shared,type:'password'},{...shared,placeholder:'Buscar factura…'},{...shared,tag:'BUTTON'}])assert.notDeepEqual(normalizeListSearchControls([old]),normalizeListSearchControls([changed]));
 assert.notDeepEqual(normalizeListSearchControls([old]),normalizeListSearchControls([]));
 const button={tag:'BUTTON',placeholder:null,type:'button',label:'Abrir calendario',text:'',disabled:false};assert.notDeepEqual(normalizeListSearchControls([button]),normalizeListSearchControls([{...button,tag:'INPUT'}]));
 const date={tag:'INPUT',placeholder:'',type:'date',label:'Desde',text:'',disabled:false};assert.notDeepEqual(normalizeListSearchControls([date]),normalizeListSearchControls([{...date,type:'search'}]));
});
