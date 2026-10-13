export type ImportedSupplierProduct={id:string;product_id:string;supplier_sku?:string|null;supplier_description:string};

export function normalizeImportedProductName(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/([a-z])(\d)/g,'$1 $2').replace(/(\d)([a-z])/g,'$1 $2')
    .replace(/[^a-z0-9]+/g,' ').trim();
}

export function matchImportedSupplierProduct(rows:ImportedSupplierProduct[],description:string,supplierSku?:string|null){
  const sku=String(supplierSku||'').trim().toUpperCase();
  const bySku=sku?rows.filter(row=>String(row.supplier_sku||'').trim().toUpperCase()===sku):[];
  const key=normalizeImportedProductName(description);
  const matches=bySku.length?bySku:rows.filter(row=>normalizeImportedProductName(row.supplier_description)===key);
  if(new Set(matches.map(row=>row.product_id)).size>1){
    throw new Error(`La referencia o descripción ${sku||description} corresponde a varios productos. Revisa sus vínculos antes de importar.`);
  }
  return matches[0]||null;
}
