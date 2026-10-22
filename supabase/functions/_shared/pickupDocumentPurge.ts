import {createPickupReportDocument} from './pickupReportDocument.ts';
const bucketName='pickup-report-documents';
const sha=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const imageUrl=(bytes:Uint8Array)=>{let value='';for(let n=0;n<bytes.length;n+=8192)value+=String.fromCharCode(...bytes.slice(n,n+8192));return 'data:image/png;base64,'+btoa(value)};
/** No PII enters logs or responses. Disabled SQL claim is a no-op, including cleanup. */
export async function purgePickupDocuments(admin:any,makeDocument:(created:Date,fileId:string)=>any,limit=100){
 const lease=crypto.randomUUID(),bucket=admin.storage.from(bucketName);
 const {data:targets,error}=await admin.rpc('pickup_document_purge_claim',{p_lease:lease,p_limit:Math.min(100,Math.max(1,limit))});
 if(error)throw Error('PICKUP_PURGE_CLAIM_FAILED');let purged=0,failed=0;
 for(const target of targets||[]){
  try{
   const prefix=String(target.owner)+'/'+String(target.reportId)+'/';
   const owned=(path:unknown):path is string=>typeof path==='string'&&path.startsWith(prefix)&&!path.includes('..');
   if(!Array.isArray(target.paths)||target.paths.some((path:unknown)=>!owned(path)))throw Error('PICKUP_PURGE_PATH_INVALID');
   if(target.kind==='report'){
    const {data:bundle,error:readError}=await admin.rpc('pickup_document_purge_read',{p_lease:lease,p_owner:target.owner,p_report:target.reportId});
    if(readError||!bundle)throw Error('PICKUP_PURGE_READ_FAILED');
    const image=async(path:string|null)=>{if(!path)return null;if(!owned(path))throw Error('PICKUP_PURGE_PATH_INVALID');const {data,error}=await bucket.download(path);if(error||!data)throw Error('PICKUP_PURGE_READ_FAILED');return imageUrl(new Uint8Array(await data.arrayBuffer()))};
    const generatedAt=new Date(bundle.generatedAt),path=prefix+'retention/report.pdf';
    const bytes=createPickupReportDocument(bundle.report,()=>makeDocument(generatedAt,String(target.reportId).replaceAll('-','')),{generatedAt,requireStamp:!!bundle.stampPath,signatures:bundle.signatures,stampDataUrl:await image(bundle.stampPath),logoDataUrl:await image(bundle.logoPath)});
    const hash=await sha(bytes);const uploaded=await bucket.upload(path,bytes,{contentType:'application/pdf',upsert:false});
    if(uploaded.error&&!/duplicate|already exists/i.test(String(uploaded.error.message))&&String(uploaded.error.statusCode)!=='409')throw Error('PICKUP_REDACTED_UPLOAD_FAILED');
    const stored=await bucket.download(path);if(stored.error||!stored.data||await sha(new Uint8Array(await stored.data.arrayBuffer()))!==hash)throw Error('PICKUP_REDACTED_HASH_MISMATCH');
    const staged=await admin.rpc('pickup_document_purge_stage',{p_lease:lease,p_owner:target.owner,p_report:target.reportId,p_hash:hash});if(staged.error)throw Error('PICKUP_REDACTED_STAGE_FAILED');
   }
   for(let n=0;n<target.paths.length;n+=100){const {error:removeError}=await bucket.remove(target.paths.slice(n,n+100));if(removeError)throw Error('PICKUP_PURGE_STORAGE_FAILED')}
   const {error:finishError}=await admin.rpc('pickup_document_purge_finish',{p_lease:lease,p_kind:target.kind,p_owner:target.owner,p_target:target.id});if(finishError)throw Error('PICKUP_PURGE_FINISH_FAILED');purged++;
  }catch{failed++}
 }
 return {ok:failed===0,claimed:targets?.length||0,purged,failed};
}
