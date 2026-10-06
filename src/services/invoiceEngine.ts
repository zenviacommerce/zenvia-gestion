import {fingerprint,mergeDocuments,validateDocument,type EngineDocument} from '../../shared/invoiceEngineCore.mjs';
import type {ExpenseCategory,InvoiceImportCandidate,InvoiceSource,NewInvoiceInput} from '../types';
import {getActiveTenant,supabase} from './supabase';
import {prepareEnginePages} from './invoiceEnginePages';
import {archiveSourceDocument,getSourceDocument} from './repository';

export function documentFromCandidate(c:InvoiceImportCandidate):EngineDocument{
  const original=c.engineDocument;
  return {...original,supplier:{...original?.supplier,name:c.supplierName,taxId:c.supplierTaxId,email:c.supplierEmail,phone:c.supplierPhone,address:c.supplierAddress},number:c.invoiceNumber,issueDate:c.invoiceDate,currency:c.currency||original?.currency||'EUR',categoryId:c.categoryId,subtotal:c.subtotal,vat:c.vat,surcharge:c.equivalenceSurcharge,withholding:c.withholding,total:c.total,
    type:original?.type||'complete',taxes:original?.taxes||[],pages:original?.pages||[1],confidence:original?.confidence||{},lines:c.lines.map((l,i)=>({...original?.lines[i],description:l.description,reference:l.supplierSku||undefined,quantity:l.quantity,unit:l.unit||undefined,unitPrice:l.unitPrice??0,discountPercent:l.discountPercent??0,net:l.lineNet??0,vatRate:l.taxRate??0,vat:l.taxAmount??0,total:l.lineTotal??0,kind:original?.lines[i]?.kind||'expense'}))};
}
export function candidateFromDocument(file:File,fileHash:string,d:EngineDocument,model?:string):InvoiceImportCandidate{
  const validation=validateDocument(d);
  return {id:crypto.randomUUID(),file,fileHash,status:validation.status,reviewReason:validation.reasons.join(' · '),supplierName:d.supplier?.name||'',supplierTaxId:d.supplier?.taxId||undefined,supplierEmail:d.supplier?.email||undefined,supplierPhone:d.supplier?.phone||undefined,supplierAddress:d.supplier?.address||undefined,invoiceNumber:d.number||'',invoiceDate:d.issueDate||'',categoryId:d.categoryId||undefined,subtotal:d.subtotal??0,vat:d.vat??0,equivalenceSurcharge:d.surcharge??0,withholding:d.withholding??0,total:d.total??0,currency:d.currency||undefined,text:'',confidence:validation.confidence,usedOcr:false,analysisEngine:'invoice-engine',analysisModel:model,analysisWarnings:[...validation.reasons,...validation.corrections],engineDocument:validation.document,lines:(d.lines||[]).map(l=>({description:l.description,supplierSku:l.reference,quantity:l.quantity,unit:l.unit,unitPrice:l.unitPrice,discountPercent:l.discountPercent,lineNet:l.net,taxRate:l.vatRate,taxAmount:l.vat,lineTotal:l.total}))};
}
function emptyDocument(reason:string):EngineDocument{return {supplier:{name:''},type:'complete',number:'',issueDate:'',currency:'EUR',lines:[],taxes:[],subtotal:0,vat:0,surcharge:0,withholding:0,total:0,confidence:{},pages:[1],extractionWarning:reason};}
export const InvoiceEngine={
  async analyze(file:File,categories:ExpenseCategory[],onProgress?:(m:string)=>void,analysisFile:File=file,source:InvoiceSource='manual',metadata:Record<string,unknown>={}):Promise<InvoiceImportCandidate[]>{
    // Original is archived BEFORE inference, even when the model is offline.
    const {data:context,error:contextError}=await supabase.rpc('invoice_engine_context');
    if(contextError||!context?.can_import)throw new Error('InvoiceEngine no está habilitado en la base de este entorno o no tienes permiso de importación.');
    const archived=await archiveSourceDocument(file,source,{engineVersion:1},'invoice-engine-originals');
    if(source==='gmail'&&typeof metadata.gmailImportId==='string'){const {error}=await supabase.from('gmail_imports').update({source_document_id:archived.id}).eq('id',metadata.gmailImportId);if(error)throw error;}
    const {data:cameraOriginals}=await supabase.from('source_documents').select('id').contains('metadata',{cameraBundle:file.name});
    if(cameraOriginals?.length)metadata={...metadata,originalDocumentIds:cameraOriginals.map(d=>d.id)};
    const pages=await prepareEnginePages(analysisFile,onProgress);const tenant=getActiveTenant();
    const {data:{session}}=await supabase.auth.getSession();if(!session||!tenant)throw new Error('Sesión no válida.');
    let documents:EngineDocument[]=[],model:string|undefined;
    try{
      for(let i=0;i<pages.length;i+=3){
        onProgress?.(`Analizando páginas ${i+1}–${Math.min(i+3,pages.length)} de ${pages.length}…`);
        const response=await fetch('/api/invoice-engine',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(270000),body:JSON.stringify({tenantUrl:tenant.supabase_url.replace(/\/$/,''),pages:pages.slice(i,i+3),continuationContext:documents.length?{supplier:documents[documents.length-1].supplier,number:documents[documents.length-1].number,series:documents[documents.length-1].series,issueDate:documents[documents.length-1].issueDate}:null})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'El modelo no está disponible.');
        documents.push(...result.documents);model=result.model;
      }
      documents=mergeDocuments(documents);if(!documents.length)throw new Error('No se ha encontrado una factura legible.');
    }catch(e){documents=[{...emptyDocument(e instanceof Error?e.message:'Error de extracción.'),pages:pages.map(p=>p.number)}];}
    const candidates:InvoiceImportCandidate[]=[];
    for(const [i,d] of documents.entries()){
      if(d.categoryId&&!categories.some(c=>c.id===d.categoryId))d.categoryId=undefined;
      const c=candidateFromDocument(file,archived.fileHash,d,model);c.sourceDocumentId=archived.id;c.text=pages.filter(p=>d.pages.includes(p.number)).map(p=>p.text).join('\n');
      c.multiInvoiceSource=documents.length>1;c.bundleIndex=i+1;c.bundleCount=documents.length;
      const {data:id,error}=await supabase.rpc('invoice_engine_stage',{p_source:archived.id,p_key:`${d.pages.join(',')}:${i}`,p_document:c.engineDocument,p_status:c.status,p_channel:source,p_metadata:{...metadata,model:model||null,sourcePages:d.pages}});
      if(error)throw new Error('No se puede registrar la revisión: aplica la migración InvoiceEngine en la base de este entorno.');c.engineJobId=String(id);candidates.push(c);
    }
    window.dispatchEvent(new Event('zenvia:invoice-engine-updated'));return candidates;
  },
  async save(input:NewInvoiceInput){
    let d=input.extraction?.invoiceEngine as EngineDocument|undefined;let jobId=input.extraction?.engineJobId;
    if(!d){
      const {data:context,error:contextError}=await supabase.rpc('invoice_engine_context');if(contextError||!context?.can_import)throw new Error('Aplica la migración InvoiceEngine en la base de este entorno.');
      const lines=(input.lines||[]).map(l=>({description:l.description,reference:l.supplierSku||undefined,kind:l.supplierSku?'product' as const:'expense' as const,quantity:l.quantity,unitPrice:l.unitPrice??0,discountPercent:l.discountPercent??0,net:l.lineNet??0,vatRate:l.taxRate??0,vat:l.taxAmount??0,total:l.lineTotal??0}));
      const taxes=new Map<number,{rate:number;base:number;amount:number}>();for(const l of lines){const t=taxes.get(l.vatRate)||{rate:l.vatRate,base:0,amount:0};t.base+=l.net;t.amount+=l.vat;taxes.set(l.vatRate,t);}
      d={supplier:{name:input.supplierName,taxId:input.supplierTaxId,email:input.supplierEmail,phone:input.supplierPhone,address:input.supplierAddress},type:input.total<0?'credit':'complete',number:input.invoiceNumber,issueDate:input.invoiceDate,currency:input.currency||'EUR',categoryId:input.categoryId,lines,taxes:[...taxes.values()],subtotal:input.subtotal,vat:input.vat,surcharge:input.equivalenceSurcharge||0,withholding:input.withholding,total:input.total,confidence:{},pages:[1]};
      const archived=input.sourceDocumentId?await getSourceDocument(input.sourceDocumentId):await archiveSourceDocument(input.file,input.source,{engineVersion:1},'invoice-engine-originals');
      const {data:id,error}=await supabase.rpc('invoice_engine_stage',{p_source:archived.id,p_key:'structured-input',p_document:d,p_status:'needs_review',p_channel:input.source,p_metadata:{structuredInput:true}});if(error)throw error;jobId=String(id);input={...input,extraction:{...input.extraction,reviewedByUser:true}};
    }
    if(!d||typeof jobId!=='string')throw new Error('Falta el trabajo de InvoiceEngine. Vuelve a analizar el documento.');
    const reviewed=input.extraction?.reviewedByUser===true;const validation=validateDocument(d,{reviewed});
    if(validation.status!=='ready')throw new Error(validation.reasons.join(' · '));
    const {data,error}=await supabase.rpc('invoice_engine_commit',{p_job:jobId,p_document:validation.document,p_reviewed:reviewed});
    if(error)throw new Error(error.message);
    const {data:job}=await supabase.from('invoice_engine_jobs').select('metadata').eq('id',jobId).single();
    if(job?.metadata?.gmailImportId){const gmailId=job.metadata.gmailImportId;const {data:related}=await supabase.from('invoice_engine_jobs').select('invoice_id,status').contains('metadata',{gmailImportId:gmailId});const pending=related?.some(j=>j.status!=='ignored'&&!j.invoice_id);const ids=(related||[]).map(j=>j.invoice_id).filter(Boolean);const {updateGmailImport}=await import('./gmail');await updateGmailImport(gmailId,pending?'error':'imported',ids[0]||null,{reviewRequired:!!pending,invoiceIds:ids,sharedPipeline:true});}
    window.dispatchEvent(new Event('zenvia:invoice-engine-updated'));return data.invoiceId as string;
  },
  async split(candidate:InvoiceImportCandidate,source:InvoiceSource){const d=documentFromCandidate(candidate);const {data:originalJob,error:jobError}=await supabase.from('invoice_engine_jobs').select('metadata').eq('id',candidate.engineJobId).single();if(jobError)throw jobError;const {data,error}=await supabase.rpc('invoice_engine_stage',{p_source:candidate.sourceDocumentId,p_key:'user-split:'+crypto.randomUUID(),p_document:d,p_status:'needs_review',p_channel:source,p_metadata:{...originalJob?.metadata,splitFromJobId:candidate.engineJobId}});if(error)throw error;window.dispatchEvent(new Event('zenvia:invoice-engine-updated'));return {...candidate,id:crypto.randomUUID(),engineJobId:String(data),engineReviewed:false,status:'needs_review' as const};},
  async ignore(id:string){const {error}=await supabase.from('invoice_engine_jobs').update({status:'ignored'}).eq('id',id);if(error)throw error;window.dispatchEvent(new Event('zenvia:invoice-engine-updated'));},
  async pending(){const {data,error}=await supabase.from('invoice_engine_jobs').select('*').in('status',['ready','needs_review']).order('created_at',{ascending:false}).limit(100);if(error)throw error;return data||[];},
  async reopen(job:any):Promise<InvoiceImportCandidate>{
    const original=await getSourceDocument(job.source_document_id);const {data,error}=await supabase.storage.from(original.storageBucket||'invoices').download(original.storagePath);if(error)throw error;
    const c=candidateFromDocument(new File([data],original.originalName,{type:original.mimeType}),original.fileHash,job.document,job.metadata?.model);c.engineJobId=job.id;c.sourceDocumentId=original.id;return c;
  },
  fingerprint,
};
