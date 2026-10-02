import type { ExpenseCategory, Invoice, InvoiceImportCandidate, InvoiceSource, NewInvoiceInput } from '../types';
import { readInvoiceDocumentEnhanced, readInvoiceDocumentsEnhanced } from './invoiceReaderEnhanced';
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

async function candidateFromRead(
  file:File,
  fileHash:string,
  read:InvoiceReadResult,
  policy:ExpenseImportPolicy,
  bundle?:{index:number;count:number},
):Promise<InvoiceImportCandidate>{
  const readAmounts={
    subtotal:Number(read.subtotal||0),
    vat:Number(read.vat||0),
    total:Number(read.total||0),
    withholding:Number(read.withholding||0),
    equivalenceSurcharge:Number(read.aiEquivalenceSurcharge||0),
  };
  const repairedAmounts=invoiceAmountsConsistent(readAmounts)
    ?{subtotal:readAmounts.subtotal,vat:readAmounts.vat,total:readAmounts.total,equivalenceSurcharge:readAmounts.equivalenceSurcharge}
    :repairInvoiceAmounts(read.text,{subtotal:readAmounts.subtotal,vat:readAmounts.vat,total:readAmounts.total});
  const repairedLines=repairInvoiceProductLines(read.text,read.lines);
  const party=extractInvoiceParty(read.text,{role:'supplier',nameHint:read.supplierName,invoiceNumber:read.invoiceNumber,invoiceDate:read.invoiceDate});
  const contact=extractSupplierContactData(read.text,read.supplierName);
  const details=extractSupplierInvoiceDetails(read.text,read.supplierName);
  const recipient=validateInvoiceRecipient(read.text,read.invoiceDate);
  const equivalenceSurcharge=read.aiEquivalenceSurcharge!=null
    ?Number(read.aiEquivalenceSurcharge)
    :'equivalenceSurcharge' in repairedAmounts?Number(repairedAmounts.equivalenceSurcharge||0):0;

  let status:InvoiceImportCandidate['status']='ready';
  let reviewReason:string|undefined;
  const configuredReview=expenseRequiresReview(policy,{
    invoiceNumber:read.invoiceNumber,
    supplierName:read.supplierName,
    invoiceDate:read.invoiceDate,
    total:repairedAmounts.total,
    confidence:read.confidence,
  });
  if(configuredReview.required){
    status='needs_review';
    const parts:string[]=[];
    const fieldLabels:Record<string,string>={
      invoiceNumber:'número de factura',
      issueDate:'fecha de factura',
      supplier:'proveedor',
      total:'total',
    };
    if(configuredReview.missing.length)parts.push(`Faltan campos obligatorios: ${configuredReview.missing.map(field=>fieldLabels[field]||field).join(', ')}`);
    if(configuredReview.lowConfidence)parts.push(`Confianza inferior al ${Math.round(policy.confidenceThreshold*100)} %`);
    reviewReason=parts.join(' · ');
  }else if(recipient.needsReview){
    status='needs_review';
    reviewReason=recipient.reason;
  }
  if(bundle&&bundle.count>1&&!read.invoiceNumber){
    status='needs_review';
    reviewReason=[reviewReason,'PDF con varias facturas: revisa e indica el número de esta factura.'].filter(Boolean).join(' · ');
  }

  const aiUnavailable=read.analysisEngine!=='hybrid-ai-verified'&&(read.analysisWarnings||[]).some(message=>/IA documental no disponible|OPENAI_API_KEY|analizador IA/i.test(message));
  if(aiUnavailable){
    status='needs_review';
    reviewReason=[reviewReason,'La validación IA documental no está disponible; esta lectura procede del motor determinista y requiere confirmación humana.'].filter(Boolean).join(' · ');
  }

  const integrity=validateInvoiceCandidateIntegrity({
    supplierName:read.supplierName,
    invoiceNumber:read.invoiceNumber,
    invoiceDate:read.invoiceDate,
    subtotal:repairedAmounts.subtotal,
    vat:repairedAmounts.vat,
    equivalenceSurcharge,
    withholding:read.withholding,
    total:repairedAmounts.total,
  });
  if(!integrity.safe){
    status='needs_review';
    reviewReason=[reviewReason,...integrity.reasons].filter(Boolean).join(' · ');
  }

  return {
    id:crypto.randomUUID(),
    file,
    fileHash,
    status,
    reviewReason,
    supplierName:read.supplierName,
    supplierTaxId:details.taxId||read.aiIssuer?.taxId||contact.taxId||party.taxId,
    supplierEmail:read.aiIssuer?.email||contact.email||party.email,
    supplierPhone:read.aiIssuer?.phone||contact.phone||party.phone,
    supplierAddress:read.aiIssuer?.address||details.address||formatInvoicePartyAddress(party),
    supplierWebsite:details.website,
    recipientTaxId:recipient.detectedTaxId,
    recipientName:recipient.detectedName,
    invoiceNumber:read.invoiceNumber,
    invoiceDate:read.invoiceDate,
    categoryId:read.categoryId||policy.defaultCategoryId||undefined,
    subtotal:repairedAmounts.subtotal,
    vat:repairedAmounts.vat,
    equivalenceSurcharge,
    withholding:read.withholding,
    total:repairedAmounts.total,
    currency:read.currency,
    text:read.text,
    confidence:read.confidence,
    usedOcr:read.usedOcr,
    analysisEngine:read.analysisEngine,
    analysisModel:read.analysisModel,
    analysisWarnings:read.analysisWarnings,
    lines:repairedLines,
    multiInvoiceSource:Boolean(bundle&&bundle.count>1),
    bundleIndex:bundle?.index,
    bundleCount:bundle?.count,
  };
}

export async function prepareInvoiceCandidate(
  file:File,
  categories:ExpenseCategory[],
  onProgress?:(message:string)=>void,
  analysisFile:File=file,
  policy:ExpenseImportPolicy=expenseImportPolicyFromSettings(undefined),
):Promise<InvoiceImportCandidate>{
  const [read,fileHash]=await Promise.all([
    readInvoiceDocumentEnhanced(analysisFile,categories,onProgress),
    sha256File(file),
  ]);
  return candidateFromRead(file,fileHash,read,policy);
}

export async function prepareInvoiceCandidates(
  file:File,
  categories:ExpenseCategory[],
  onProgress?:(message:string)=>void,
  analysisFile:File=file,
  policy:ExpenseImportPolicy=expenseImportPolicyFromSettings(undefined),
):Promise<InvoiceImportCandidate[]>{
  const [reads,fileHash]=await Promise.all([
    readInvoiceDocumentsEnhanced(analysisFile,categories,onProgress),
    sha256File(file),
  ]);
  const count=reads.length;
  return Promise.all(reads.map((read,index)=>candidateFromRead(
    file,
    fileHash,
    read,
    policy,
    count>1?{index:index+1,count}:undefined,
  )));
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

export function invoiceCandidateToInput(candidate:InvoiceImportCandidate,source:InvoiceSource='manual'):NewInvoiceInput{
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
