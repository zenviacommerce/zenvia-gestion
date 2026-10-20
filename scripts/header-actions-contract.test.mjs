import test from 'node:test';import assert from 'node:assert/strict';
import {assertHeaderActionsPreserved} from './header-actions-contract.mjs';
test('fails a design migration that drops the preexisting transport-tariff action',()=>{
 assert.throws(()=>assertHeaderActionsPreserved(['Informes de recogida','Tarifas de transporte','Impresión directa'],['Informes de recogida','Impresión directa'],'Pedidos'),/Pedidos: missing header action\(s\): Tarifas de transporte/);
});
test('accepts retained actions and additions without accepting a lost duplicate',()=>{
 assert.doesNotThrow(()=>assertHeaderActionsPreserved(['Importar facturas','Exportar (32)'],['Exportar (32)',' Importar  facturas ','Nuevo']));
 assert.throws(()=>assertHeaderActionsPreserved(['Actualizar','Actualizar'],['Actualizar']),/Actualizar/);
});
