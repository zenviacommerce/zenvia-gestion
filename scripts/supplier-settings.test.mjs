import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('Proveedores settings exposes defaults enrichment identity and alias management',async()=>{
  const page=await read('../src/pages/Settings.tsx');
  assert.match(page,/function SuppliersSection/);
  for(const label of [
    'Tipo por defecto','Categoría por defecto','Crear proveedores automáticamente',
    'Enriquecer CIF\/NIF','Enriquecer email','Enriquecer teléfono','Enriquecer web',
    'Enriquecer dirección','Solo completar campos vacíos','Detectar proveedores duplicados',
    'Umbral de identidad','Alias explícitos','Añadir alias'
  ]) assert.match(page,new RegExp(label,'i'),label);
  assert.match(page,/loadEntityAliases/);
  assert.match(page,/addEntityAlias/);
  assert.match(page,/updateEntityAlias/);
  assert.match(page,/deleteEntityAlias/);
  assert.match(page,/updateSection\('suppliers'/);
});

test('supplier editor persists configured default category',async()=>{
  const editor=await read('../src/services/supplierEditor.ts');
  const modal=await read('../src/components/SupplierModal.tsx');
  assert.match(editor,/defaultCategoryId/);
  assert.match(editor,/default_category_id/);
  assert.match(modal,/settings\.suppliers\.defaultType/);
  assert.match(modal,/settings\.suppliers\.defaultCategoryId/);
});

test('InvoiceEngine resolves VAT first and only fills missing supplier contact data',async()=>{
const source=await read('../supabase/migrations/20261002190000_invoice_engine.sql');
assert.match(source,/invoice_engine_tax_key\(tax_id\)=tax/);assert.match(source,/invoice_engine_name_similarity/);assert.match(source,/coalesce\(nullif\(email,''\)/);assert.match(source,/coalesce\(nullif\(phone,''\)/);
});
