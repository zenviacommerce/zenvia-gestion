import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const orders=readFileSync('src/pages/Orders.tsx','utf8');
const toolbar=readFileSync('src/components/BulkSelectionToolbar.tsx','utf8');
assert.match(orders,/scopeLabel=\{selectionScope==='all'\?'este filtro':'esta página'\}/);
assert.match(orders,/La selección incluye esta página/);
assert.match(orders,/Se borra al cambiar de página o filtros/);
assert.match(toolbar,/Seleccionar todos.*scopeLabel/s);
console.log('Orders selection scope is explicit.');

assert.match(orders,/priced.length===1\?' opción con precio':' opciones con precio'/);
