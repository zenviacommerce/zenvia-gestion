import { InvoiceEngine } from './invoiceEngine';
import { supabase, INVOICE_BUCKET } from './supabase';
import type { AppData, ExpenseCategory, Invoice, InvoicePaymentStatus, NewInvoiceInput, Product, Supplier } from '../types';
import { canonicalizeSupplierName, isLikelySameSupplier, isPlausibleSupplierName, supplierIdentityKey } from './supplierIdentity';
import { extractSupplierContactData, type SupplierContactData } from './supplierContactExtractor';
import { extractSupplierInvoiceDetails } from './supplierInvoiceDetails';
import { repairInvoiceAmounts, repairInvoiceProductLines } from './invoiceProductLine';
import { emailError, normalizeEmail, normalizePhone, normalizeTaxId, phoneError, taxIdError } from './validation';
import { sanitizeDatabaseSingleLine, sanitizeDatabaseText, sanitizeDatabaseValue } from './textSanitizer';
import { resolveEntityAlias } from './entityAliases';
import { loadAppSettings } from './settings';
import { expenseImportPolicyFromSettings, type ExpenseImportPolicy } from './expenseImportPolicy';
import { DEFAULT_APP_SETTINGS, type ProductsSettings, type SuppliersSettings } from './settingsSchema';
import { applyExpenseInvoiceImportedAutomation, loadAutomationRule } from './automationRules';
import { startActivity } from './activity';

const numberOrZero = (value: unknown) => Number(value ?? 0) || 0;
const normalizeProductKey = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

type SupplierProfileData = SupplierContactData & { address?: string; website?: string };

export async function bootstrapUser() {
  const { error } = await supabase.rpc('bootstrap_expense_categories');
  if (error) throw error;
}

export async function loadAppData(): Promise<AppData> {
  const activity=startActivity({
    label:'Actualizando datos de gestión',
    detail:'Facturas, productos, proveedores y categorías…',
    showAfterMs:350,
  });
  try{
  const [invoiceResult, lineResult, supplierResult, categoryResult, productResult, sourceDocumentResult] = await Promise.all([
    supabase.from('invoices').select('*').order('issue_date', { ascending: false, nullsFirst: false }),
    supabase.from('invoice_lines').select('*'),
    supabase.from('suppliers').select('*').order('name'),
    supabase.from('expense_categories').select('*').eq('active', true).order('sort_order'),
    supabase.from('products').select('*').eq('active', true).order('name'),
    supabase.from('source_documents').select('id,storage_bucket,storage_path,original_name,mime_type,file_hash'),
  ]);

  for (const result of [invoiceResult, lineResult, supplierResult, categoryResult, productResult, sourceDocumentResult]) {
    if (result.error) throw result.error;
  }

  const suppliers: Supplier[] = (supplierResult.data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    taxId: s.tax_id,
    email: s.email,
    phone: s.phone,
    address: s.address,
    website: s.website,
    supplierType: s.supplier_type,
    defaultCategoryId: s.default_category_id,
  }));
  const supplierById = new Map(suppliers.map(s => [s.id, s]));

  const categories: ExpenseCategory[] = (categoryResult.data ?? []).map((c: any) => ({ id: c.id, name: c.name, icon: c.icon }));
  const categoryById = new Map(categories.map(c => [c.id, c]));

  const sourceDocumentById=new Map((sourceDocumentResult.data??[]).map((document:any)=>[document.id,document]));

  const linesByInvoice = new Map<string, any[]>();
  for (const line of lineResult.data ?? []) {
    const bucket = linesByInvoice.get(line.invoice_id) ?? [];
    bucket.push(line);
    linesByInvoice.set(line.invoice_id, bucket);
  }

  const invoices: Invoice[] = (invoiceResult.data ?? []).map((i: any) => {
    const sourceDocument=sourceDocumentById.get(i.source_document_id) as any;
    return {
    id: i.id,
    sourceDocumentId:i.source_document_id||null,
    supplierId: i.supplier_id,
    supplierName: supplierById.get(i.supplier_id)?.name ?? 'Proveedor sin asignar',
    invoiceNumber: i.invoice_number ?? '—',
    invoiceDate: i.issue_date ?? i.received_date,
    fiscalYear: i.fiscal_year,
    fiscalQuarter: i.fiscal_quarter,
    categoryId: i.expense_category_id,
    category: categoryById.get(i.expense_category_id)?.name ?? 'Sin categoría',
    subtotal: numberOrZero(i.net_amount),
    vat: numberOrZero(i.tax_amount),
    equivalenceSurcharge: numberOrZero(i.equivalence_surcharge_amount),
    withholding: numberOrZero(i.withholding_amount),
    total: numberOrZero(i.total_amount),
    currency:String(i.currency||'EUR').toUpperCase(),
    source: i.source,
    status: i.status,
    paymentStatus: i.payment_status==='paid'?'paid':'unpaid',
    paidAt: i.paid_at || null,
    fileName: sourceDocument?.original_name||i.file_name,
    filePath: sourceDocument?.storage_path||i.file_path,
    fileHash: sourceDocument?.file_hash||i.file_hash,
    lines: (linesByInvoice.get(i.id) ?? []).map((l: any) => ({
      id: l.id,
      description: l.description,
      quantity: numberOrZero(l.quantity),
      unitPrice: l.unit_price == null ? null : numberOrZero(l.unit_price),
      normalizedUnitPrice: l.normalized_unit_price == null ? null : numberOrZero(l.normalized_unit_price),
      lineTotal: l.line_total == null ? null : numberOrZero(l.line_total),
      supplierSku: l.supplier_sku,
      productId: l.product_id,
      priceUpdateStatus: l.price_update_status,
    })),
  };
  });

  const products: Product[] = (productResult.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    unit: p.base_unit,
    lastPrice: p.last_cost == null ? null : numberOrZero(p.last_cost),
    previousPrice: p.previous_cost == null ? null : numberOrZero(p.previous_cost),
    supplierId: p.last_supplier_id,
    supplier: supplierById.get(p.last_supplier_id)?.name ?? '—',
    lastPurchaseDate: p.last_purchase_date,
  }));

  return { invoices, products, suppliers, categories };
  }finally{activity.finish();}
}

async function sha256(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export type ArchivedSourceDocument={
  id:string;
  storagePath:string;
  storageBucket?:string;
  originalName:string;
  mimeType:string;
  fileHash:string;
};

function isUniqueViolation(error:unknown){
  const value=error as any;
  return value?.code==='23505'||/duplicate key|unique constraint/i.test(String(value?.message||value||''));
}

export async function getSourceDocument(sourceDocumentId:string):Promise<ArchivedSourceDocument>{
  const {data,error}=await supabase.from('source_documents')
    .select('id,storage_bucket,storage_path,original_name,mime_type,file_hash')
    .eq('id',sourceDocumentId)
    .maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('El documento original ya no está disponible.');
  return {
    id:String(data.id),
    storagePath:String(data.storage_path),
    storageBucket:String(data.storage_bucket||INVOICE_BUCKET),
    originalName:String(data.original_name||'documento.pdf'),
    mimeType:String(data.mime_type||'application/pdf'),
    fileHash:String(data.file_hash||''),
  };
}

export async function archiveSourceDocument(
  file:File,
  source:'manual'|'camera'|'gmail',
  metadata:Record<string,unknown>={},
  storageBucket:string=INVOICE_BUCKET,
):Promise<ArchivedSourceDocument>{
  const {data:userData}=await supabase.auth.getUser();
  const user=userData.user;
  if(!user)throw new Error('Sesión no válida.');

  const fileHash=await sha256(file);
  if(fileHash){
    const {data:existing,error:existingError}=await supabase.from('source_documents')
      .select('id,storage_bucket,storage_path,original_name,mime_type,file_hash')
      .eq('file_hash',fileHash)
      .limit(1)
      .maybeSingle();
    if(existingError)throw existingError;
    if(existing){
      return {
        id:String(existing.id),
        storagePath:String(existing.storage_path),
        storageBucket:String(existing.storage_bucket||INVOICE_BUCKET),
        originalName:String(existing.original_name||file.name||'documento.pdf'),
        mimeType:String(existing.mime_type||file.type||'application/pdf'),
        fileHash:String(existing.file_hash||fileHash),
      };
    }
  }

  const year=new Date().getFullYear();
  const safeName=(file.name||'documento.pdf').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-100);
  const storagePath=`${user.id}/${storageBucket==='invoice-engine-originals'?'invoice-engine':'source'}/${year}/${crypto.randomUUID()}-${safeName}`;
  const mimeType=file.type||'application/pdf';
  const {error:storageError}=await supabase.storage.from(storageBucket).upload(storagePath,file,{
    contentType:mimeType,
    upsert:false,
  });
  if(storageError)throw storageError;

  const {data:created,error:createError}=await supabase.from('source_documents').insert({
    storage_bucket:storageBucket,
    storage_path:storagePath,
    original_name:sanitizeDatabaseSingleLine(file.name)||'documento.pdf',
    mime_type:mimeType,
    file_hash:fileHash||null,
    document_kind:'expense_source',
    source_channel:source,
    metadata:sanitizeDatabaseValue(metadata),
  }).select('id,storage_bucket,storage_path,original_name,mime_type,file_hash').single();

  if(createError){
    if(isUniqueViolation(createError)&&fileHash){
      const {data:existing,error:existingError}=await supabase.from('source_documents')
        .select('id,storage_bucket,storage_path,original_name,mime_type,file_hash')
        .eq('file_hash',fileHash)
        .limit(1)
        .maybeSingle();
      await supabase.storage.from(storageBucket).remove([storagePath]).catch(()=>undefined);
      if(existingError)throw existingError;
      if(existing){
        return {
          id:String(existing.id),
          storagePath:String(existing.storage_path),
        storageBucket:String(existing.storage_bucket||INVOICE_BUCKET),
          originalName:String(existing.original_name||file.name||'documento.pdf'),
          mimeType:String(existing.mime_type||mimeType),
          fileHash:String(existing.file_hash||fileHash),
        };
      }
    }
    await supabase.storage.from(storageBucket).remove([storagePath]).catch(()=>undefined);
    throw createError;
  }

  return {
    id:String(created.id),
    storagePath:String(created.storage_path),
    storageBucket:String(created.storage_bucket||INVOICE_BUCKET),
    originalName:String(created.original_name||file.name||'documento.pdf'),
    mimeType:String(created.mime_type||mimeType),
    fileHash:String(created.file_hash||fileHash),
  };
}

export async function createInvoice(input: NewInvoiceInput) {
  return InvoiceEngine.save(input);
}

export async function updateInvoiceStatus(invoiceId: string, status: 'pending' | 'reviewed' | 'accounted') {
  const { error } = await supabase.from('invoices').update({ status }).eq('id', invoiceId);
  if (error) throw error;
}

export async function updateInvoicePaymentStatus(invoiceId:string,paymentStatus:InvoicePaymentStatus,paidAt?:string|null){
  return updateInvoicesPaymentStatus([invoiceId],paymentStatus,paidAt);
}

export async function updateInvoicesPaymentStatus(invoiceIds:string[],paymentStatus:InvoicePaymentStatus,paidAt?:string|null){
  const ids=[...new Set(invoiceIds.filter(Boolean))];
  if(!ids.length)return;
  const resolvedPaidAt=paymentStatus==='paid'
    ?(paidAt||new Date().toISOString().slice(0,10))
    :null;
  const {error}=await supabase.from('invoices').update({
    payment_status:paymentStatus,
    paid_at:resolvedPaidAt,
  }).in('id',ids);
  if(error)throw error;
}

export async function deleteInvoice(invoiceId: string, _filePath?: string | null) {
  // La factura es una interpretación contable corregible. El documento fuente
  // es evidencia inmutable y nunca se borra al eliminar la interpretación.
  const { error } = await supabase.from('invoices').delete().eq('id', invoiceId);
  if (error) throw error;
}

export async function getInvoiceFileUrl(path: string) {
  const { data, error } = await supabase.storage.from(path.includes('/invoice-engine/')?'invoice-engine-originals':INVOICE_BUCKET).createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function addProduct(input: { name: string; sku?: string; category?: string; unit: string }) {
  const { error } = await supabase.from('products').insert({
    name: sanitizeDatabaseSingleLine(input.name),
    sku: sanitizeDatabaseSingleLine(input.sku) || null,
    category: sanitizeDatabaseSingleLine(input.category) || null,
    base_unit: sanitizeDatabaseSingleLine(input.unit) || 'ud',
  });
  if (error) throw error;
}

export async function updateProduct(productId: string, input: { name: string; sku?: string; category?: string; unit: string }) {
  const { error } = await supabase.from('products').update({
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    category: input.category?.trim() || null,
    base_unit: input.unit.trim() || 'ud',
  }).eq('id', productId);
  if (error) throw error;
}

export async function deleteProduct(productId: string) {
  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) throw error;
}

type SupplierInput = { name: string; taxId?: string; email?: string; phone?: string; address?: string; website?: string; supplierType: 'unclassified' | 'goods' | 'service' | 'both' };

export async function addSupplier(input: SupplierInput) {
  const { error } = await supabase.from('suppliers').insert({
    name: sanitizeDatabaseSingleLine(input.name),
    tax_id: sanitizeDatabaseSingleLine(input.taxId) || null,
    email: sanitizeDatabaseSingleLine(input.email) || null,
    phone: sanitizeDatabaseSingleLine(input.phone) || null,
    address: sanitizeDatabaseSingleLine(input.address) || null,
    website: sanitizeDatabaseSingleLine(input.website) || null,
    supplier_type: input.supplierType,
  });
  if (error) throw error;
}

export async function updateSupplier(supplierId: string, input: SupplierInput) {
  const { error } = await supabase.from('suppliers').update({
    name: input.name.trim(),
    tax_id: input.taxId?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    website: input.website?.trim() || null,
    supplier_type: input.supplierType,
  }).eq('id', supplierId);
  if (error) throw error;
}

export async function deleteSupplier(supplierId: string) {
  const { error } = await supabase.from('suppliers').delete().eq('id', supplierId);
  if (error) throw error;
}

export async function downloadInvoiceFile(path: string) {
  const { data, error } = await supabase.storage.from(path.includes('/invoice-engine/')?'invoice-engine-originals':INVOICE_BUCKET).download(path);
  if (error) throw error;
  return data;
}
