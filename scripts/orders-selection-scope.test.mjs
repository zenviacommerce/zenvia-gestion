import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const orders=readFileSync('src/pages/Orders.tsx','utf8');
const toolbar=readFileSync('src/components/BulkSelectionToolbar.tsx','utf8');
assert.match(orders,/scopeLabel="esta página"/);
assert.match(orders,/La selección se conserva al buscar, filtrar, cambiar de página o de pestaña/);
assert.match(orders,/Ver selección/);
assert.match(orders,/Quitar selección/);
assert.match(toolbar,/Seleccionar todos.*scopeLabel/s);
console.log('Orders selection scope is explicit.');

assert.match(orders,/countLabel\(priced.length,'opción con precio','opciones con precio'\)/);
