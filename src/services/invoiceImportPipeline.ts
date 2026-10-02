import { InvoiceEngine, documentFromCandidate } from './invoiceEngine';
import type { ExpenseCategory, Invoice, InvoiceImportCandidate, InvoiceSource, NewInvoiceInput } from '../types';
import type { InvoiceReadResult } from './invoiceReader';
import { repairInvoiceAmounts, repairInvoiceProductLines } from './invoiceProductLine';
import { extractSupplierContactData } from './supplierContactExtractor';
import { extractSupplierInvoiceDetails } from './supplierInvoiceDetails';
import { validateInvoiceRecipient } from './invoiceRecipientRules';
import { extractInvoiceParty, formatInvoicePartyAddress } from './invoicePartyExtractor';
import { isLikelySameSupplier, isPlausibleSupplierName } from './supplierIdentity';
import { expenseImportPolicyFromSettings, expenseRequiresReview, type ExpenseImportPolicy } from './expenseImportPolicy';
import { invoiceAmountsConsistent } from './invoiceFiscalReconciler';

async function sha256File(file:File){
  const buffer=await file.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function normalizeKey(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function saneSupplierName(value:string){return isPlausibleSupplierName(value);}

function saneInvoiceNumber(value:string){
  const number=value.trim();
  if(!number||number.length<2||number.length>60)return false;
  if(!/\d/.test(number))return false;
  if(/^(?:factura|invoice|original|copia|proforma)$/i.test(number))return false;
  if(/^\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*(?:\d{2}|\d{4})$/.test(number))return false;
  if(/^20\d{2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}$/.test(number))return false;
  return true;
}

function saneInvoiceDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T12:00:00Z`);
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)return false;
  const max=new Date();
  max.setUTCDate(max.getUTCDate()+2);
  return date.getTime()<=max.getTime();
}

export function validateInvoiceCandidateIntegrity(candidate:Pick<InvoiceImportCandidate,
  'supplierName'|'invoiceNumber'|'invoiceDate'|'subtotal'|'vat'|'equivalenceSurcharge'|'withholding'|'total'
>){
  const reasons:string[]=[];
  if(!saneSupplierName(candidate.supplierName))reasons.push('El proveedor no se ha identificado con suficiente seguridad.');
  if(!saneInvoiceNumber(candidate.invoiceNumber))reasons.push('El número de factura no parece válido.');
  if(!saneInvoiceDate(candidate.invoiceDate))reasons.push('La fecha de factura no se ha identificado con suficiente seguridad.');
  if(!(candidate.total>0))reasons.push('El total de factura no es válido.');
  if(!invoiceAmountsConsistent({
    subtotal:candidate.subtotal,
    vat:candidate.vat,
    equivalenceSurcharge:candidate.equivalenceSurcharge,
    withholding:candidate.withholding,
    total:candidate.total,
  }))reasons.push('El cierre fiscal no cuadra: base, impuestos, retenciones y total no son consistentes.');
  return {safe:reasons.length===0,reasons};
}

export async function createManualInvoiceCandidate(file:File):Promise<InvoiceImportCandidate>{
  return {
    id:crypto.randomUUID(),
    file,
    fileHash:await sha256File(file),
    status:'needs_review',
    reviewReason:'No se pudo completar la lectura automática. Revisa y completa los datos antes de guardar.',
    supplierName:'',
    invoiceNumber:'',
    invoiceDate:new Date().toISOString().slice(0,10),
    subtotal:0,
    vat:0,
    equivalenceSurcharge:0,
    withholding:0,
    total:0,
    currency:undefined,
    text:'',
    confidence:0,
    usedOcr:false,
    lines:[],
  };
}

export async function prepareInvoiceCandidate(
  file:File,
  categories:ExpenseCategory[],
  onProgress?:(message:string)=>void,
  analysisFile:File=file,
  policy:ExpenseImportPolicy=expenseImportPolicyFromSettings(undefined),
  source:InvoiceSource='manual',
):Promise<InvoiceImportCandidate>{
  const candidates=await InvoiceEngine.analyze(file,categories,onProgress,analysisFile,source);
  if(candidates.length!==1)throw new Error('Este documento contiene varias facturas: usa la importación múltiple para revisarlas todas.');
  return candidates[0];
}

export async function prepareInvoiceCandidates(
  file:File,
  categories:ExpenseCategory[],
  onProgress?:(message:string)=>void,
  analysisFile:File=file,
  policy:ExpenseImportPolicy=expenseImportPolicyFromSettings(undefined),
  source:InvoiceSource='manual',
):Promise<InvoiceImportCandidate[]>{
  return InvoiceEngine.analyze(file,categories,onProgress,analysisFile,source);
}

export function classifyInvoiceCandidate(candidate:InvoiceImportCandidate,existingInvoices:Invoice[],policy:ExpenseImportPolicy=expenseImportPolicyFromSettings(undefined)):InvoiceImportCandidate{
  if(!policy.detectDuplicates)return candidate;
  const supplierName=normalizeKey(candidate.supplierName);
  const invoiceNumber=normalizeKey(candidate.invoiceNumber);
  const duplicate=existingInvoices.find(existing=>
    Boolean(!candidate.multiInvoiceSource && existing.fileHash && existing.fileHash === candidate.fileHash)
    || Boolean(
      invoiceNumber
      && supplierName
      && (
        normalizeKey(existing.supplierName)===supplierName
        || isLikelySameSupplier(existing.supplierName,candidate.supplierName)
      )
      && normalizeKey(existing.invoiceNumber)===invoiceNumber
    )
  );
  if(duplicate){
    const reason=`Factura duplicada${duplicate.invoiceNumber&&duplicate.invoiceNumber!=='—'?` (${duplicate.invoiceNumber})`:''}.`;
    if(policy.blockHighConfidenceDuplicates)return {...candidate,status:'duplicate',reviewReason:reason};
    if(policy.warnAmbiguousMatches)return {...candidate,status:'needs_review',reviewReason:`Posible duplicado: ${reason} Revisa antes de guardar.`};
  }
  return candidate;
}

export function invoiceCandidateToInput(candidate:InvoiceImportCandidate,source:InvoiceSource='manual',reviewed:boolean=candidate.engineReviewed===true):NewInvoiceInput{
  return {
    file:candidate.file,
    source,
    sourceDocumentId:candidate.sourceDocumentId,
    supplierName:candidate.supplierName,
    supplierTaxId:candidate.supplierTaxId,
    supplierEmail:candidate.supplierEmail,
    supplierPhone:candidate.supplierPhone,
    supplierAddress:candidate.supplierAddress,
    supplierWebsite:candidate.supplierWebsite,
    invoiceNumber:candidate.invoiceNumber,
    invoiceDate:candidate.invoiceDate,
    categoryId:candidate.categoryId,
    subtotal:candidate.subtotal,
    vat:candidate.vat,
    equivalenceSurcharge:candidate.equivalenceSurcharge,
    withholding:candidate.withholding,
    total:candidate.total,
    currency:candidate.currency,
    ocrText:candidate.text,
    extraction:{
      ...(candidate.engineDocument?{invoiceEngine:documentFromCandidate(candidate),engineJobId:candidate.engineJobId,reviewedByUser:reviewed}:{}),
      parser:candidate.analysisEngine||(candidate.usedOcr?'browser-ocr-v2':'pdf-text-v2'),
      analysisModel:candidate.analysisModel??null,
      analysisWarnings:candidate.analysisWarnings??[],
      recipientTaxId:candidate.recipientTaxId??null,
      recipientName:candidate.recipientName??null,
      equivalenceSurcharge:candidate.equivalenceSurcharge,
      lineCount:candidate.lines.length,
      multiInvoiceSource:candidate.multiInvoiceSource||false,
      bundleIndex:candidate.bundleIndex??null,
      bundleCount:candidate.bundleCount??null,
      detectedCurrency:candidate.currency??null,
    },
    extractionConfidence:candidate.confidence,
    lines:candidate.lines,
  };
}
