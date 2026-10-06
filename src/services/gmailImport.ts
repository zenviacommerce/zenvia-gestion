import type {ExpenseCategory,InvoiceImportCandidate} from '../types';
import {InvoiceEngine} from './invoiceEngine';
import {invoiceCandidateToInput} from './invoiceImportPipeline';
import {downloadGmailAttachment,updateGmailImport,type GmailCandidate} from './gmail';
export type GmailImportOutcome={kind:'imported';invoiceId:string}|{kind:'review';candidate:InvoiceImportCandidate};
export async function saveReviewedGmailCandidate(gmail:GmailCandidate,prepared:InvoiceImportCandidate,onProgress?:(m:string)=>void){
  onProgress?.('Guardando factura revisada…');
  const id=await InvoiceEngine.save(invoiceCandidateToInput(prepared,'gmail',true));
  return id;
}
export async function importGmailCandidate(accessToken:string,gmail:GmailCandidate,categories:ExpenseCategory[],onProgress?:(m:string)=>void):Promise<GmailImportOutcome>{
  if(!gmail.id)throw new Error('El correo aún no está registrado.');
  try{
    onProgress?.('Descargando documento de Gmail…');
    const file=await downloadGmailAttachment(accessToken,gmail);
    const candidates=await InvoiceEngine.analyze(file,categories,onProgress,file,'gmail',{gmailImportId:gmail.id,gmailMessageId:gmail.messageId});
    const ids:string[]=[];let review:InvoiceImportCandidate|undefined;
    for(const candidate of candidates){
      if(candidate.status==='needs_review'){review ||= candidate;continue;}
      ids.push(await InvoiceEngine.save(invoiceCandidateToInput(candidate,'gmail')));
    }
    if(review){await updateGmailImport(gmail.id,'error',ids[0]||null,{reviewRequired:true,reviewReason:review.reviewReason,sharedPipeline:true,invoiceIds:ids,documentCount:candidates.length});return {kind:'review',candidate:review};}
    if(!ids.length)throw new Error('El correo no contiene una factura identificable.');
    await updateGmailImport(gmail.id,'imported',ids[0],{sharedPipeline:true,invoiceIds:ids,documentCount:candidates.length});return {kind:'imported',invoiceId:ids[0]};
  }catch(error){const message=error instanceof Error?error.message:'Error al importar Gmail.';await updateGmailImport(gmail.id,'error',null,{lastError:message}).catch(()=>undefined);throw error;}
}
