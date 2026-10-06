import {createAdminClient,authenticateUser,getAdminKey} from '../_shared/amazon/supabase.ts';
import {IMPORT_KINDS,importLabel,importModule,type ImportKind} from '../../../shared/imports/contracts.ts';
import {importError} from '../../../shared/imports/state.ts';
import {checked,requireModule,ensureImportScheduler} from '../_shared/imports/repository.ts';
import {validateDocumentCandidate} from '../../../shared/imports/documentRules.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const kindOf=(v:unknown):ImportKind=>{if(!IMPORT_KINDS.includes(v as ImportKind))throw new Error('Tipo de importación no válido.');return v as ImportKind;};
function kick(){const url=Deno.env.get('SUPABASE_URL');const promise=fetch(`${url}/functions/v1/import-worker`,{method:'POST',headers:{apikey:getAdminKey(),'x-import-worker-secret':getAdminKey(),'Content-Type':'application/json'},body:'{}'}).then(()=>undefined).catch(()=>undefined);(globalThis as any).EdgeRuntime?.waitUntil(promise);}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return response({ok:true});if(req.method!=='POST')return response({error:'Método no permitido.'},405);
 try{
  const admin=createAdminClient(),caller=await authenticateUser(req,admin),body=await req.json();const action=String(body.action||'');
  if(action==='list'){
   const [recent,active]=await Promise.all([checked<any[]>(admin.from('import_jobs').select('*').eq('owner_id',caller.data_owner_id).order('created_at',{ascending:false}).limit(100)),checked<any[]>(admin.from('import_jobs').select('*').eq('owner_id',caller.data_owner_id).in('status',['queued','running','waiting_review']).order('created_at',{ascending:false}).limit(1000))]);const jobs=[...new Map([...recent,...active].map(j=>[j.id,j])).values()].sort((a,b)=>b.created_at.localeCompare(a.created_at));
   const amazon=(caller.role==='admin'||caller.permissions?.includes('amazon'))?await checked<any[]>(admin.from('amazon_sync_jobs').select('id,source,status,rows_processed,last_error,created_at,updated_at').eq('owner_id',caller.data_owner_id).order('created_at',{ascending:false}).limit(50)):[];
   return response({amazon:amazon.map(j=>({...j,last_error:j.last_error?importError(j.last_error).message:null})),jobs:jobs.filter(j=>caller.role==='admin'||(j.module!=='settings'&&caller.permissions?.includes(j.module)))});
  }
  if(['detail','cancel','retry','review','manual_review'].includes(action)){
   if(!uuid(body.jobId))throw new Error('Importación no válida.');
   const job=await checked<any>(admin.from('import_jobs').select('*').eq('id',body.jobId).eq('owner_id',caller.data_owner_id).single());requireModule(caller,job.kind);
   if(action!=='detail'){
    if(action==='review'){
     const validation=validateDocumentCandidate(body.candidate,job.kind,true);
     if(!validation.safe)throw new Error(validation.reasons.join(' · '));
    }
    await checked(admin.rpc('import_job_action',{p_job:job.id,p_actor:caller.user_id,p_action:action,p_item:body.itemId||null,p_version:body.version??null,p_candidate:body.candidate||null}));if(action!=='cancel'&&action!=='manual_review')kick();
   }
   const next=await checked(admin.from('import_jobs').select('*').eq('id',job.id).single());
   const items=await checked(admin.from('import_job_items').select('*').eq('job_id',job.id).eq('owner_id',caller.data_owner_id).order('created_at'));
   return response({job:next,items});
  }
  if(action==='prepare_source'){
   const kind=kindOf(body.kind);requireModule(caller,kind);if(!['expense_document','sales_document','transport_tariff'].includes(kind))throw new Error('Esta entrada no admite archivos.');
   const bytes=Number(body.size);if(!(bytes>0&&bytes<=20*1024*1024))throw new Error('El archivo debe tener entre 1 byte y 20 MB.');
   const name=String(body.name||'documento').replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,150);
   const bucket=kind==='expense_document'?'invoices':kind==='transport_tariff'?'transport-tariffs':'import-sources';
   const path=`${caller.data_owner_id}/imports/${crypto.randomUUID()}/${name}`;
   const signed=await checked<any>(admin.storage.from(bucket).createSignedUploadUrl(path));
   return response({bucket,path,token:signed.token});
  }
  if(action==='register_source'){
   const kind=kindOf(body.kind);requireModule(caller,kind);if(!['expense_document','sales_document','transport_tariff'].includes(kind))throw new Error('Esta entrada no admite archivos.');
   const bucket=kind==='expense_document'?'invoices':kind==='transport_tariff'?'transport-tariffs':'import-sources';
   if(body.bucket!==bucket||!String(body.path||'').startsWith(`${caller.data_owner_id}/imports/`))throw new Error('Documento no disponible.');
   const blob=await checked<Blob>(admin.storage.from(bucket).download(body.path));if(blob.size>20*1024*1024)throw new Error('El archivo supera 20 MB.');
   const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
   const existing=await checked<any>(admin.from('source_documents').select('*').eq('owner_id',caller.data_owner_id).eq('file_hash',hash).maybeSingle());
   if(existing){if(existing.storage_path!==body.path)await admin.storage.from(bucket).remove([body.path]);return response({source:existing});}
   const source=await checked(admin.from('source_documents').insert({owner_id:caller.data_owner_id,created_by:caller.user_id,storage_bucket:bucket,storage_path:body.path,original_name:String(body.name||'documento').slice(0,240),mime_type:String(body.mimeType||blob.type).slice(0,100),file_hash:hash,document_kind:kind==='sales_document'?'sales_source':kind==='transport_tariff'?'tariff_source':'expense_source',source_channel:body.source==='camera'?'camera':'manual'}).select('*').single());return response({source});
  }
  if(action==='original'){
   if(!uuid(body.sourceId))throw new Error('Documento no válido.');
   const source=await checked<any>(admin.from('source_documents').select('*').eq('id',body.sourceId).eq('owner_id',caller.data_owner_id).single());
   requireModule(caller,source.document_kind==='sales_source'?'sales_document':source.document_kind==='tariff_source'?'transport_tariff':'expense_document');
   const signed=await checked<any>(admin.storage.from(source.storage_bucket).createSignedUrl(source.storage_path,120));return response({url:signed.signedUrl,name:source.original_name,mimeType:source.mime_type});
  }
  if(action==='enqueue'){
   const kind=kindOf(body.kind),module=requireModule(caller,kind);await ensureImportScheduler(admin);const accountId=body.accountId||null;
   let account:any=null;if(accountId){if(!uuid(accountId))throw new Error('Cuenta no válida.');account=await checked(admin.from('integration_accounts').select('*').eq('id',accountId).eq('owner_id',caller.data_owner_id).eq('enabled',true).single());}
   const options:any={source:body.options?.source==='camera'?'camera':'manual',months:Math.max(1,Math.min(24,Number(body.options?.months)||12)),history:Boolean(body.options?.history),shippingProvider:body.options?.shippingProvider,tariffId:body.options?.tariffId};
   let items:any[]=[];
   if(kind==='gmail_scan'||(kind==='expense_document'&&body.gmailIds?.length)){
    if(!account||account.provider!=='gmail'||account.credential_source!=='vault')throw new Error('Renueva Gmail desde Integraciones para habilitar la conexión persistente.');
    const config=Deno.env.get('GOOGLE_CLIENT_ID');const secret=await checked<any>(admin.rpc('integration_read_secret',{p_secret_id:account.secret_id}));const stored=JSON.parse(String(secret||'{}'));
    if(!stored.refreshToken||stored.clientId!==config)throw new Error('Renueva la autorización de Gmail desde Integraciones.');
    if(kind==='gmail_scan')items=[{key:`scan:${accountId}`,label:account.display_name||'Gmail',input:{accountId}}];
    else {
     if(body.gmailIds.length>100)throw new Error('Selecciona como máximo 100 adjuntos.');
     for(const id of [...new Set(body.gmailIds)]){if(!uuid(id))throw new Error('Adjunto no válido.');const row=await checked<any>(admin.from('gmail_imports').select('*').eq('id',id).eq('owner_id',caller.data_owner_id).eq('integration_account_id',accountId).single());items.push({key:`gmail:${id}`,label:row.attachment_name,input:{gmailId:id,accountId},sourceDocumentId:row.source_document_id});}
    }
   }else if(['expense_document','sales_document','transport_tariff'].includes(kind)){
    const ids=body.sourceDocumentIds;if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!uuid(id)))throw new Error('Selecciona entre 1 y 100 documentos.');
    if(kind==='transport_tariff'&&!['sendcloud','envia'].includes(options.shippingProvider))throw new Error('Selecciona el proveedor logístico.');
    const sources=await checked<any[]>(admin.from('source_documents').select('*').eq('owner_id',caller.data_owner_id).in('id',ids));if(sources.length!==new Set(ids).size)throw new Error('Documento no disponible.');
    const expected=kind==='sales_document'?'sales_source':kind==='transport_tariff'?'tariff_source':'expense_source';
    if(sources.some(s=>s.document_kind!==expected))throw new Error('El documento pertenece a otra sección.');
    if(options.tariffId){if(kind!=='transport_tariff'||!uuid(options.tariffId))throw new Error('Tarifa no válida.');const draft=await checked<any>(admin.from('transport_tariff_documents').select('id').eq('id',options.tariffId).eq('owner_id',caller.data_owner_id).eq('status','draft').single());if(!draft)throw new Error('Borrador no disponible.');}
    items=options.source==='camera'?[{key:ids.join(':'),label:sources[0].original_name,sourceDocumentId:ids[0],input:{sourceIds:ids}}]:sources.map(s=>({key:s.id,label:s.original_name,sourceDocumentId:s.id,input:{sourceIds:[s.id]}}));
   }else{
    const provider=kind==='shopify_orders'?'shopify':kind==='envia_shipments'?'envia':'sendcloud';
    if(account&&account.provider!==provider)throw new Error('Cuenta de otro proveedor.');
    const accounts=account?[account]:await checked<any[]>(admin.from('integration_accounts').select('id,display_name').eq('owner_id',caller.data_owner_id).eq('provider',provider).eq('enabled',true));
    items=accounts.map(a=>({key:a.id,label:a.display_name,input:{accountId:a.id}}));if(!items.length)throw new Error('No hay cuentas conectadas.');
   }
   if(!uuid(body.requestKey))throw new Error('Solicitud no válida.');
   const job=await checked(admin.rpc('import_enqueue',{p_owner:caller.data_owner_id,p_actor:caller.user_id,p_kind:kind,p_module:module,p_label:importLabel[kind],p_request_key:body.requestKey,p_account:accountId,p_options:options,p_items:items}));kick();return response({job},202);
  }
  throw new Error('Acción no válida.');
 }catch(error){const {message}=importError(error);return response({error:message},/Sesión/.test(message)?401:/permiso|acceso|disponible/.test(message)?403:400);}
});
