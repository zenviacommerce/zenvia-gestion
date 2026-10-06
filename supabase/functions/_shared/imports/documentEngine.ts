import {normalizeAlias} from '../../../../src/services/entityAliasCore.ts';
import {canonicalizeSupplierName} from '../../../../src/services/supplierIdentity.ts';
import {emailError,taxIdError,phoneError,normalizeEmail,normalizeTaxId} from '../../../../src/services/validation.ts';
import type {ImportItem,ImportJob,ImportOutcome} from '../../../../shared/imports/contracts.ts';
import {validateDocumentCandidate} from '../../../../shared/imports/documentRules.ts';
import {expenseImportPolicyFromSettings} from '../../../../src/services/expenseImportPolicy.ts';
import {isLikelySameSupplier,supplierIdentityKey} from '../../../../src/services/supplierIdentity.ts';
import {checked,assertJobAccess} from './repository.ts';
const RULES_VERSION='persistent-v1';
export async function documentRequest(path:string,body?:unknown){
 const url=(Deno.env.get('DOCUMENT_WORKER_URL')||'').replace(/\/$/,''),secret=Deno.env.get('DOCUMENT_WORKER_SECRET');
 if(!url||!secret)throw new Error('Servicio documental no disponible: falta configurar la conexión con el servidor local.');
 const res=await fetch(url+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const data=await res.json();if(!res.ok){const error:any=new Error(String(data.error||`Servicio documental HTTP ${res.status}`));error.retryable=res.status===429||res.status>=500;throw error;}return data;
}
async function hash(value:string){const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(data)).map(b=>b.toString(16).padStart(2,'0')).join('');}
function base64(bytes:Uint8Array){let str='';for(let offset=0;offset<bytes.length;offset+=32768)str+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(str);}
async function prepareCandidate(admin:any,job:ImportJob,c:any,text:string){
 c={...c,text:c.text||text,currency:String(c.currency||'').toUpperCase(),lines:Array.isArray(c.lines)?c.lines:[],confidence:Number.isFinite(c.confidence)?c.confidence:0};
 if(job.kind==='expense_document'){
  c.supplierName=canonicalizeSupplierName(String(c.supplierName||''));
  if(c.supplierTaxId)c.supplierTaxId=taxIdError(String(c.supplierTaxId))?'':normalizeTaxId(String(c.supplierTaxId));
  if(c.supplierEmail)c.supplierEmail=emailError(String(c.supplierEmail))?'':normalizeEmail(String(c.supplierEmail));
  if(c.supplierPhone&&phoneError(String(c.supplierPhone)))c.supplierPhone='';
  c.lines=c.lines.map((l:any)=>{if(typeof l.quantity!=='number'||typeof l.unitPrice!=='number'||typeof l.taxRate!=='number')return l;const net=Math.round(l.quantity*l.unitPrice*100)/100,tax=Math.round(net*l.taxRate)/100;return {...l,lineNet:l.lineNet??net,taxAmount:l.taxAmount??tax,lineTotal:l.lineTotal??Math.round((net+tax)*100)/100,normalizedUnitPrice:l.normalizedUnitPrice??l.unitPrice};});
  c.equivalenceSurcharge=Number(c.equivalenceSurcharge)||0;c.withholding=Number(c.withholding)||0;
  const suppliers=await checked<any[]>(admin.from('suppliers').select('id,name,tax_id').eq('owner_id',job.owner_id));
  const key=(v:any)=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const tax=c.supplierTaxId?suppliers.filter(s=>key(s.tax_id)===key(c.supplierTaxId)):[];
  const names=suppliers.filter(s=>supplierIdentityKey(s.name)===supplierIdentityKey(c.supplierName));
  const alias=await checked<any>(admin.from('entity_alias_rules').select('target_entity_id').eq('owner_id',job.owner_id).eq('entity_type','supplier').eq('active',true).eq('normalized_alias',normalizeAlias(c.supplierName)).order('priority').limit(1).maybeSingle());
  const aliasMatches=alias?suppliers.filter(s=>s.id===alias.target_entity_id):[];if(alias&&!aliasMatches.length)throw new Error('El alias de proveedor apunta a un registro que ya no existe. Revísalo en Configuración.');
  const matches=alias?aliasMatches:tax.length?tax:names;
  if(matches.length===1)c.supplierId=matches[0].id;
  else if(matches.length>1||suppliers.some(s=>isLikelySameSupplier(s.name,c.supplierName)))c.reviewReason='Hay varios posibles proveedores o un nombre similar. Revisa la identidad.';
 }else if(job.kind==='sales_document'){
  const clients=await checked<any[]>(admin.from('clients').select('id,name,tax_id').eq('owner_id',job.owner_id).eq('active',true));
  const key=(v:any)=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const matches=clients.filter(s=>(c.proposedClient?.taxId&&key(s.tax_id)===key(c.proposedClient.taxId))||key(s.name)===key(c.proposedClient?.name));
  c.clientId=matches.length===1?matches[0].id:'';
  const series=await checked<any[]>(admin.from('sales_invoice_series').select('id,prefix,kind,year').eq('owner_id',job.owner_id).eq('active',true).eq('kind','standard').eq('year',Number(String(c.issueDate||'').slice(0,4))||new Date().getUTCFullYear()));
  c.seriesId=series.sort((a,b)=>b.prefix.length-a.prefix.length).find(s=>String(c.invoiceNumber||'').startsWith(s.prefix))?.id||series[0]?.id||'';
  c.taxAmount=c.taxAmount??c.vat;c.totalAmount=c.totalAmount??c.total;
  const existing=await checked<any>(admin.from('sales_invoices').select('id,status').eq('owner_id',job.owner_id).eq('invoice_number',String(c.invoiceNumber||'')).maybeSingle());if(existing?.status==='draft'){c.existingInvoiceId=existing.id;c.reviewReason='Ya existe este borrador. Al confirmar se actualizarán sus datos, sin crear otra factura.';}else if(existing){c.reviewReason='Ya existe una factura con este número. Comprueba el original.';}
 }else{c.currencyCode=String(c.currencyCode||'').toUpperCase();c.parserProvider='ollama';}
 return c;
}
export async function executeDocument(admin:any,job:ImportJob,item:ImportItem):Promise<ImportOutcome&{committed?:boolean}>{
 const config=await checked<any>(admin.from('app_settings').select('config').eq('owner_id',job.owner_id).maybeSingle());
 const policy=expenseImportPolicyFromSettings(config?.config?.expenses);policy.autoCreateSuppliers=policy.autoCreateSuppliers&&config?.config?.suppliers?.autoCreate!==false;
 let candidate=item.result?.candidate as any;
 if(!candidate){
  let sources:any[]=[],sourceIds=(item.input.sourceIds as string[])||[item.source_document_id];
  if(sourceIds.some(id=>!id))throw new Error('Falta el documento original.');
  sources=await checked<any[]>(admin.from('source_documents').select('*').eq('owner_id',job.owner_id).in('id',sourceIds));
  if(sources.length!==new Set(sourceIds).size)throw new Error('Documento no disponible.');
  sources.sort((a,b)=>sourceIds.indexOf(a.id)-sourceIds.indexOf(b.id));
  const cacheKey=await hash(job.owner_id+':'+job.kind+':'+sources.map(s=>s.file_hash).join(':'));
  const cached=job.options.tariffId?null:await checked<any>(admin.from('import_document_cache').select('result').eq('owner_id',job.owner_id).eq('source_key',cacheKey).eq('rules_version',RULES_VERSION).maybeSingle());
  let analysis=cached?.result;
  if(!analysis){
   if(!item.checkpoint.analysisId){
    const files=[];let total=0;
    for(const source of sources){const blob=await checked<Blob>(admin.storage.from(source.storage_bucket).download(source.storage_path));total+=blob.size;if(blob.size>policy.maxAttachmentMb*1024*1024||total>50*1024*1024)throw new Error('Los documentos superan el tamaño máximo de importación.');files.push({name:source.original_name,mimeType:source.mime_type,data:base64(new Uint8Array(await blob.arrayBuffer()))});}
    const analysisId=await hash(cacheKey+':'+item.id);await documentRequest('/analyze',{analysisId,kind:job.kind,sources:files});
    return {status:'queued',stage:'Analizando en el servidor local',checkpoint:{...item.checkpoint,analysisId,submittedAt:new Date().toISOString()},delaySeconds:10};
   }
   if(item.checkpoint.submittedAt&&Date.now()-new Date(String(item.checkpoint.submittedAt)).getTime()>24*3600*1000){const e:any=new Error('El análisis local supera 24 horas. Comprueba el servicio y vuelve a importar el documento.');e.retryable=false;throw e;}
   const state=await documentRequest(`/analyses/${item.checkpoint.analysisId}`);
   if(state.status==='error')throw new Error(String(state.error||'No se pudo analizar el documento.'));
   if(state.status!=='completed')return {status:'queued',stage:state.error||'Analizando en el servidor local',checkpoint:item.checkpoint,delaySeconds:10};
   analysis=state.result;
   await checked(admin.from('import_document_cache').upsert({owner_id:job.owner_id,source_key:cacheKey,rules_version:RULES_VERSION,result:analysis}));
  }
  if(!Array.isArray(analysis?.candidates)||!analysis.candidates.length)throw new Error('El motor local no devolvió datos de factura.');
  const candidates=[];for(const raw of analysis.candidates)candidates.push(await prepareCandidate(admin,job,raw,analysis.text||''));
  if(candidates.length>1){await checked(admin.rpc('import_expand_candidates',{p_item:item.id,p_lease:item.lease_token,p_candidates:candidates.slice(1)}));item.input.multiInvoiceSource=true;}
  candidate=candidates[0];
 }
 if(job.kind==='expense_document'){candidate=await prepareCandidate(admin,job,candidate,candidate.text||'');const categories=await checked<any[]>(admin.from('expense_categories').select('id,name').eq('owner_id',job.owner_id));if(!candidate.categoryId){candidate.categoryId=policy.defaultCategoryId||categories.find(c=>String(candidate.categoryName||'').trim().toLowerCase()===c.name.trim().toLowerCase())?.id||(candidate.expenseType==='goods'?categories.find(c=>/mercanc/i.test(c.name))?.id:undefined);}}
 const reviewed=item.input.reviewed===true;
 if(job.kind==='expense_document'&&!policy.autoCreateSuppliers&&!candidate.supplierId)candidate.reviewReason='Selecciona un proveedor existente: la creación automática está desactivada.';
 // Tariffs are created as drafts only; existing review/activation UI remains mandatory.
 const valid=validateDocumentCandidate(candidate,job.kind,reviewed||job.kind==='transport_tariff',policy.confidenceThreshold);
 if(!valid.safe||(!reviewed&&(job.kind==='sales_document'||(job.kind==='expense_document'&&!item.input.gmailId)))){
  const reasons=valid.reasons.length?valid.reasons:['Revisa los datos antes de importar.'];
  if(item.input.gmailId){const row=await checked<any>(admin.from('gmail_imports').select('metadata').eq('id',item.input.gmailId).eq('owner_id',job.owner_id).single());await checked(admin.from('gmail_imports').update({status:'error',metadata:{...row.metadata,reviewRequired:true,reviewReason:reasons.join(' · '),persistentJobId:job.id,persistentItemId:item.id}}).eq('id',item.input.gmailId).eq('owner_id',job.owner_id));}
  return {status:'waiting_review',stage:'Pendiente de revisión',result:{candidate:{...candidate,reviewReason:reasons.join(' · ')},sourceDocumentId:item.source_document_id}};
 }
 await assertJobAccess(admin,job);
 const result=await checked<any>(admin.rpc('import_commit_document',{p_item:item.id,p_lease:item.lease_token,p_candidate:candidate,p_policy:policy}));
 return {status:'imported',result,committed:true};
}
