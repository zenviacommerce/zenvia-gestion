import {gmailAttachments,persistentGmailReady} from '../../../../shared/imports/sourceRules.ts';
import type {ImportJob,ImportItem,ImportOutcome} from '../../../../shared/imports/contracts.ts';
import {gmailServerConfig,gmailTokenRequest} from '../gmailOAuth.ts';
import {checked,guardImportItem} from './repository.ts';
import {executeDocument} from './documentEngine.ts';
async function connection(admin:any,job:ImportJob,item:ImportItem){
 const account=await checked<any>(admin.from('integration_accounts').select('*').eq('id',item.input.accountId||job.account_id).eq('owner_id',job.owner_id).eq('provider','gmail').eq('enabled',true).single());
 const secret=await checked<any>(admin.rpc('integration_read_secret',{p_secret_id:account.secret_id}));const stored=JSON.parse(String(secret||'{}')),config=gmailServerConfig();
 if(!persistentGmailReady(account,stored,config.clientId)||!config.clientSecret)throw new Error('Renueva Gmail desde Integraciones para habilitar la conexión persistente.');
 if(stored.accessToken&&Number(stored.expiresAt)>Date.now()+60000)return {account,token:String(stored.accessToken)};
 const token=await gmailTokenRequest(new URLSearchParams({grant_type:'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,refresh_token:stored.refreshToken}));
 // Do not persist tokens in job data; the existing encrypted refresh token is sufficient.
 return {account,token:String(token.access_token)};
}
async function gmail(token:string,path:string){
 const res=await fetch('https://gmail.googleapis.com/gmail/v1/users/me'+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
 const data=await res.json();if(!res.ok)throw new Error(res.status===401?'Renueva la autorización de Gmail desde Integraciones.':`Gmail HTTP ${res.status}: ${String(data.error?.message||'Error temporal').slice(0,400)}`);return data;
}
export async function scanGmailPage(admin:any,job:ImportJob,item:ImportItem):Promise<ImportOutcome>{
 const {account,token}=await connection(admin,job,item);const config=await checked<any>(admin.from('app_settings').select('config').eq('owner_id',job.owner_id).maybeSingle());
 const pdfOnly=config?.config?.expenses?.gmailPdfOnly!==false;
 const since=new Date(job.created_at);since.setUTCMonth(since.getUTCMonth()-Number(job.options.months||12));
 const query=`has:attachment after:${since.toISOString().slice(0,10)} ${pdfOnly?'filename:pdf':'{filename:pdf filename:jpg filename:jpeg filename:png filename:webp}'} -in:spam -in:trash`;
 const params=new URLSearchParams({maxResults:'20',q:query});if(item.checkpoint.pageToken)params.set('pageToken',String(item.checkpoint.pageToken));
 const page=await gmail(token,'/messages?'+params);const messages=page.messages||[];
 const keys=messages.map((m:any)=>`gmail:${account.id}:${m.id}`);
 const cached=keys.length?await checked<any[]>(admin.from('import_document_cache').select('source_key').eq('owner_id',job.owner_id).eq('rules_version','gmail-discovery-v1').in('source_key',keys)):[];
 const known=new Set(cached.map(c=>c.source_key));let cursor=0,found=Number(item.checkpoint.found)||0;
 const process=async()=>{while(cursor<messages.length){const m=messages[cursor++],key=`gmail:${account.id}:${m.id}`;if(known.has(key))continue;
  const detail=await gmail(token,`/messages/${encodeURIComponent(m.id)}?format=full`);
  const header=(name:string)=>String(detail.payload?.headers?.find((h:any)=>String(h.name).toLowerCase()===name)?.value||'');
  const attachments=gmailAttachments(detail.payload||{}).filter(a=>!pdfOnly||a.mimeType==='application/pdf'||/\.pdf$/i.test(a.attachmentName));
  const rows=attachments.map(a=>({owner_id:job.owner_id,integration_account_id:account.id,gmail_message_id:m.id,gmail_thread_id:detail.threadId,sender:header('from'),subject:header('subject'),received_at:new Date(Number(detail.internalDate)||Date.now()).toISOString(),attachment_id:a.attachmentId,attachment_name:a.attachmentName,attachment_mime_type:a.mimeType,attachment_size:a.size,status:'found',metadata:{snippet:detail.snippet,partId:a.partId,gmailAccountEmail:account.external_account_id,persistentDiscovery:true}}));
  await guardImportItem(admin,job,item);
  if(rows.length){await checked(admin.from('gmail_imports').upsert(rows,{onConflict:'owner_id,gmail_message_id,attachment_id',ignoreDuplicates:true}));found+=rows.length;}
  await checked(admin.from('import_document_cache').upsert({owner_id:job.owner_id,source_key:key,rules_version:'gmail-discovery-v1',result:{checked:true}}));
 }};
 await Promise.all(Array.from({length:Math.min(4,messages.length)},process));
 const processed=(Number(item.checkpoint.processed)||0)+messages.length;
 return {status:page.nextPageToken?'queued':'imported',stage:page.nextPageToken?`Buscando correos · ${processed} revisados`:'Búsqueda completada',checkpoint:{pageToken:page.nextPageToken||null,processed,found},result:{messages:processed,attachments:found},delaySeconds:0};
}
export async function executeGmailDocument(admin:any,job:ImportJob,item:ImportItem){
 if(!item.source_document_id){
  const {account,token}=await connection(admin,job,item);const row=await checked<any>(admin.from('gmail_imports').select('*').eq('id',item.input.gmailId).eq('owner_id',job.owner_id).eq('integration_account_id',account.id).single());
  if(row.source_document_id)item.source_document_id=row.source_document_id;
  else{
   let data:string;
   if(String(row.attachment_id).startsWith('inline:')){const message=await gmail(token,`/messages/${row.gmail_message_id}?format=full`);const find=(p:any):any=>p.partId===row.metadata?.partId?p:(p.parts||[]).map(find).find(Boolean);data=find(message.payload)?.body?.data||'';}
   else data=(await gmail(token,`/messages/${row.gmail_message_id}/attachments/${encodeURIComponent(row.attachment_id)}`)).data;
   const bytes=Uint8Array.from(atob(data.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   const config=await checked<any>(admin.from('app_settings').select('config').eq('owner_id',job.owner_id).maybeSingle());
   if(bytes.length>(Number(config?.config?.expenses?.maxAttachmentMb)||20)*1024*1024)throw new Error('El adjunto supera el tamaño máximo configurado.');
   if(config?.config?.expenses?.gmailPdfOnly!==false&&!/\.pdf$/i.test(row.attachment_name)&&row.attachment_mime_type!=='application/pdf')return {status:'skipped' as const,stage:'Omitido: solo se permiten PDF'};
   const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
   let source=await checked<any>(admin.from('source_documents').select('*').eq('owner_id',job.owner_id).eq('file_hash',hash).maybeSingle());
   if(!source){const name=String(row.attachment_name||'factura.pdf').replace(/[^\p{L}\p{N}._ -]/gu,'_'),path=`${job.owner_id}/imports/gmail/${hash}/${name}`;
    await guardImportItem(admin,job,item);const {error}=await admin.storage.from('invoices').upload(path,bytes,{contentType:row.attachment_mime_type||'application/pdf',upsert:false});if(error&&!/already exists|duplicate/i.test(error.message))throw error;
    await checked(admin.from('source_documents').upsert({owner_id:job.owner_id,created_by:job.created_by,storage_bucket:'invoices',storage_path:path,original_name:row.attachment_name,mime_type:row.attachment_mime_type,file_hash:hash,document_kind:'expense_source',source_channel:'gmail',metadata:{gmailMessageId:row.gmail_message_id,gmailAttachmentId:row.attachment_id}},{onConflict:'owner_id,file_hash',ignoreDuplicates:true}));
    source=await checked<any>(admin.from('source_documents').select('*').eq('owner_id',job.owner_id).eq('file_hash',hash).single());
   }
   item.source_document_id=source.id;
   await guardImportItem(admin,job,item);await checked(admin.from('gmail_imports').update({source_document_id:source.id}).eq('id',row.id).eq('owner_id',job.owner_id));
  }
  await guardImportItem(admin,job,item);await checked(admin.from('import_job_items').update({source_document_id:item.source_document_id,input:{...item.input,sourceIds:[item.source_document_id]}}).eq('id',item.id).eq('lease_token',item.lease_token));
 }
 item.input.sourceIds=[item.source_document_id];return executeDocument(admin,job,item);
}
