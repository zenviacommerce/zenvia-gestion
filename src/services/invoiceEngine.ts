import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from './supabase';
import type { ExpenseCategory, InvoiceImportCandidate, NewInvoiceLineInput } from '../types';
import { prepareInvoiceCandidates as prepareLegacyCandidates } from './invoiceImportPipeline';
import { expenseImportPolicyFromSettings, type ExpenseImportPolicy } from './expenseImportPolicy';

pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;

type EnginePage={pageNumber:number;text:string;imageDataUrl?:string};
type VatBreakdown={rate:number|null;base:number|null;tax:number|null;exemptReason:string|null};
type EngineInvoice={
  pageNumbers:number[];
  documentType:'full'|'simplified'|'credit_note'|'receipt'|'unknown';
  supplier:{name:string|null;taxId:string|null;address:string|null;email:string|null;phone:string|null;iban:string|null};
  series:string|null;number:string|null;issueDate:string|null;dueDate:string|null;paymentMethod:string|null;currency:string|null;
  orderReference:string|null;deliveryNoteReference:string|null;qrPayload:string|null;
  intracommunity:boolean;reverseCharge:boolean;categoryHint:string|null;hasProducts:boolean;
  lines:Array<{supplierSku:string|null;description:string;quantity:number|null;unit:string|null;unitPrice:number|null;discountPercent:number|null;taxRate:number|null;lineNet:number|null;taxAmount:number|null;lineTotal:number|null}>;
  vatBreakdown:VatBreakdown[];
  subtotal:number|null;vat:number|null;equivalenceSurcharge:number|null;withholding:number|null;total:number|null;
  fieldConfidence:Record<string,number>;warnings:string[];
};
type EngineResponse={ok:true;engine:string;provider:string;model:string;runId:string|null;invoices:EngineInvoice[];warnings:string[]};

const dataUrl=async(file:File)=>new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);
});
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const norm=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

async function pdfPages(file:File,onProgress?:(message:string)=>void):Promise<EnginePage[]>{
  const bytes=new Uint8Array(await file.arrayBuffer());
  const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
  const pages:EnginePage[]=[];
  for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber+=1){
    if(onProgress)onProgress('Preparando página '+pageNumber+' de '+pdf.numPages+'…');
    const page=await pdf.getPage(pageNumber);
    const content=await page.getTextContent();
    const text=content.items.map((item:any)=>String(item?.str||'')).join(' ').replace(/\s+/g,' ').trim();
    const viewport=page.getViewport({scale:1.45});
    const canvas=document.createElement('canvas');
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('No se pudo preparar la vista de la factura.');
    canvas.width=Math.max(1,Math.round(viewport.width));
    canvas.height=Math.max(1,Math.round(viewport.height));
    await page.render({canvasContext:context,viewport}).promise;
    pages.push({pageNumber,text,imageDataUrl:canvas.toDataURL('image/jpeg',.82)});
    page.cleanup();
  }
  return pages;
}

async function imagePage(file:File):Promise<EnginePage[]>{
  return [{pageNumber:1,text:'',imageDataUrl:await dataUrl(file)}];
}

export async function prepareInvoiceEnginePages(file:File,onProgress?:(message:string)=>void):Promise<EnginePage[]>{
  const mime=String(file.type||'').toLowerCase(),name=file.name.toLowerCase();
  if(mime==='application/pdf'||name.endsWith('.pdf'))return pdfPages(file,onProgress);
  if(mime.startsWith('image/')||/\.(png|jpe?g|webp|heic|heif)$/i.test(name))return imagePage(file);
  throw new Error('Formato no soportado. Usa PDF, JPG, PNG, WEBP, HEIC o HEIF.');
}

function categoryIdForHint(categories:ExpenseCategory[],hint:string|null){
  const key=norm(hint||'');if(!key)return undefined;
  let best:{id:string;score:number}|null=null;
  for(const category of categories){
    const candidate=norm(category.name);if(!candidate)continue;
    let score=candidate===key?100:0;
    if(candidate.includes(key)||key.includes(candidate))score=Math.max(score,80);
    const words=key.split(' ').filter(x=>x.length>2);
    score+=words.filter(word=>candidate.includes(word)).length*10;
    if(!best||score>best.score)best={id:category.id,score};
  }
  return best&&best.score>=20?best.id:undefined;
}

function candidateFromEngine(file:File,fileHash:string,invoice:EngineInvoice,index:number,count:number,response:EngineResponse,categories:ExpenseCategory[]):InvoiceImportCandidate{
  const fieldConfidence=invoice.fieldConfidence||{};
  const critical=[
    fieldConfidence['supplier.name']??0,
    fieldConfidence['number']??0,
    fieldConfidence['issueDate']??0,
    fieldConfidence['total']??0,
  ];
  const confidence=critical.reduce((a,b)=>a+b,0)/Math.max(1,critical.length);
  const lines:NewInvoiceLineInput[]=invoice.lines.filter(line=>line.description?.trim()).map(line=>({
    description:line.description.trim(),
    supplierSku:line.supplierSku||null,
    quantity:Number(line.quantity??1)||1,
    unit:line.unit||null,
    unitPrice:line.unitPrice==null?null:Number(line.unitPrice),
    lineNet:line.lineNet==null?null:Number(line.lineNet),
    discountPercent:line.discountPercent==null?null:Number(line.discountPercent),
    taxRate:line.taxRate==null?null:Number(line.taxRate),
    taxAmount:line.taxAmount==null?null:Number(line.taxAmount),
    lineTotal:line.lineTotal==null?null:Number(line.lineTotal),
  }));
  const subtotal=round(Number(invoice.subtotal||0)),vat=round(Number(invoice.vat||0)),equivalenceSurcharge=round(Number(invoice.equivalenceSurcharge||0)),withholding=round(Number(invoice.withholding||0)),total=round(Number(invoice.total||0));
  const expected=round(subtotal+vat+equivalenceSurcharge-withholding);
  const arithmeticOk=Math.abs(expected-total)<=Math.max(.05,Math.abs(total)*.005);
  const validRates=(invoice.vatBreakdown||[]).every(row=>row.rate==null||([0,4,10,21].includes(Number(row.rate)))||(Number(row.rate)>=0&&Number(row.rate)<=30));
  const missing:string[]=[];
  if(!invoice.supplier?.name?.trim())missing.push('proveedor');
  if(!invoice.number?.trim())missing.push('número');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate||''))missing.push('fecha');
  if(!(Math.abs(total)>0))missing.push('total');
  const low=critical.some(value=>value<.78);
  const reasons:string[]=[];
  if(missing.length)reasons.push('Faltan datos críticos: '+missing.join(', '));
  if(!arithmeticOk)reasons.push('El cierre fiscal no cuadra con suficiente seguridad.');
  if(!validRates)reasons.push('Hay tipos de IVA fuera de rango.');
  if(low)reasons.push('Hay campos críticos con confianza baja.');
  reasons.push(...(invoice.warnings||[]));
  return {
    id:crypto.randomUUID(),file,fileHash,
    status:reasons.length?'needs_review':'ready',
    reviewReason:reasons.join(' · ')||undefined,
    supplierName:invoice.supplier?.name||'',
    supplierTaxId:invoice.supplier?.taxId||undefined,
    supplierEmail:invoice.supplier?.email||undefined,
    supplierPhone:invoice.supplier?.phone||undefined,
    supplierAddress:invoice.supplier?.address||undefined,
    supplierIban:invoice.supplier?.iban||undefined,
    invoiceType:invoice.documentType,
    invoiceSeries:invoice.series||undefined,
    invoiceNumber:invoice.number||'',
    invoiceDate:invoice.issueDate||'',
    dueDate:invoice.dueDate||undefined,
    paymentMethod:invoice.paymentMethod||undefined,
    orderReference:invoice.orderReference||undefined,
    deliveryNoteReference:invoice.deliveryNoteReference||undefined,
    vatBreakdown:invoice.vatBreakdown||[],
    qrPayload:invoice.qrPayload||undefined,
    intracommunity:Boolean(invoice.intracommunity),
    reverseCharge:Boolean(invoice.reverseCharge),
    categoryId:categoryIdForHint(categories,invoice.categoryHint),
    subtotal,vat,equivalenceSurcharge,withholding,total,
    currency:(invoice.currency||'EUR').toUpperCase(),
    text:'',
    confidence,
    usedOcr:true,
    analysisEngine:'invoice-engine-v1',
    analysisModel:response.model,
    analysisWarnings:[...(response.warnings||[]),...(invoice.warnings||[])],
    fieldConfidence,
    engineRunId:response.runId||undefined,
    engineOriginal:invoice as unknown as Record<string,unknown>,
    hasProducts:Boolean(invoice.hasProducts),
    lines,
    multiInvoiceSource:count>1,
    bundleIndex:index+1,bundleCount:count,
  };
}

async function hashFile(file:File){
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}

export async function analyzeInvoicesWithEngine(
  file:File,
  categories:ExpenseCategory[],
  onProgress?:(message:string)=>void,
  options:{sourceChannel?:'manual'|'camera'|'gmail';sourceDocumentId?:string;policy?:ExpenseImportPolicy}={},
):Promise<InvoiceImportCandidate[]>{
  const pages=await prepareInvoiceEnginePages(file,onProgress);
  if(onProgress)onProgress('Analizando documento con InvoiceEngine…');
  const {data,error}=await supabase.functions.invoke('invoice-engine',{body:{
    pages,categories:categories.map(category=>({id:category.id,name:category.name})),
    sourceChannel:options.sourceChannel||'manual',
    sourceDocumentId:options.sourceDocumentId||null,
    sourceName:file.name,sourceMimeType:file.type,
  }});
  if(error||data?.error){
    const detail=String(data?.error||error?.message||'InvoiceEngine no está disponible.');
    if(/not_configured|INVOICE_AI_BASE_URL|no está disponible/i.test(detail)){
      return prepareLegacyCandidates(file,categories,onProgress,file,options.policy||expenseImportPolicyFromSettings(undefined));
    }
    throw new Error(detail);
  }
  const response=data as EngineResponse;
  const fileHash=await hashFile(file);
  return response.invoices.map((invoice,index)=>candidateFromEngine(file,fileHash,invoice,index,response.invoices.length,response,categories));
}

export async function analyzeInvoiceHtmlWithEngine(
  html:string,
  syntheticFile:File,
  categories:ExpenseCategory[],
  metadata:{subject?:string;sender?:string;sourceDocumentId?:string}={},
){
  const text=html.replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
  const {data,error}=await supabase.functions.invoke('invoice-engine',{body:{
    pages:[{pageNumber:1,text}],categories:categories.map(category=>({id:category.id,name:category.name})),
    sourceChannel:'gmail',sourceDocumentId:metadata.sourceDocumentId||null,
    sourceName:metadata.subject||syntheticFile.name,sourceMimeType:'text/html',
    supplierNameHint:metadata.sender||'',
  }});
  if(error||data?.error)throw new Error(String(data?.error||error?.message||'InvoiceEngine no pudo analizar el cuerpo del correo.'));
  const response=data as EngineResponse;
  const fileHash=await hashFile(syntheticFile);
  return response.invoices.map((invoice,index)=>candidateFromEngine(syntheticFile,fileHash,invoice,index,response.invoices.length,response,categories));
}
