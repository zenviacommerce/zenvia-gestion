import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('Productos settings exposes every configured business default',async()=>{
  const page=await read('../src/pages/Settings.tsx');
  assert.match(page,/function ProductsSection/);
  for(const label of [
    'IVA por defecto','Unidad por defecto','Margen objetivo','Margen mínimo',
    'Método de coste','Actualizar coste desde importaciones','Crear productos desde facturas',
    'Proveedor por defecto','Categoría por defecto','Alerta de subida de coste',
    'Alerta de margen','Redondeo de precio','Decimales de coste'
  ]) assert.match(page,new RegExp(label,'i'),label);
  assert.match(page,/updateSection\('products'/);
});

test('new product modal consumes configured defaults and target margin',async()=>{
  const modal=await read('../src/components/ProductModal.tsx');
  assert.match(modal,/useSettings/);
  assert.match(modal,/settings\.products\.defaultVatRate/);
  assert.match(modal,/settings\.products\.defaultUnit/);
  assert.match(modal,/settings\.products\.defaultSupplierId/);
  assert.match(modal,/settings\.products\.defaultCategoryId/);
  assert.match(modal,/settings\.products\.targetMarginPct/);
  assert.match(modal,/settings\.products\.priceRounding/);
});

test('InvoiceEngine creates goods and records normalized latest purchase cost',async()=>{
const source=await read('../supabase/migrations/20261002190000_invoice_engine.sql');
assert.match(source,/l->>'kind'='product'/);assert.match(source,/insert into public.products/);assert.match(source,/insert into public.supplier_products/);assert.match(source,/old_date is null or issue>=old_date/);assert.match(source,/units_per_purchase/);
});

test('products page uses configured margin and cost increase thresholds',async()=>{
  const page=await read('../src/pages/Products.tsx');
  assert.match(page,/useSettings/);
  assert.match(page,/settings\.products\.minimumMarginPct/);
  assert.match(page,/settings\.products\.marginAlertPct/);
  assert.match(page,/settings\.products\.costIncreaseAlertPct/);
});
