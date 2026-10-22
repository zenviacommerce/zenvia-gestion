import {createPickupReportDocument,type PickupPdfSignature} from './pickupReportDocument.ts';
import {buildGmailPdfMessage,validMailAddress} from './gmailPdfMessage.ts';
type Caller={user_id:string;data_owner_id:string;role:string;active:boolean;permissions:string[]|null};
type Dependencies={admin:any;authenticate:(request:Request,admin:any)=>Promise<Caller>;makeDocument:(created:Date,fileId:string)=>any;fetch?:typeof fetch};
const bucket='pickup-report-documents',cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messages:Record<string,string>={PICKUP_SIGNATURE_REBASE_REQUIRED:'Otro conductor ha firmado desde el intento anterior. Inicia una firma nueva para incorporar el informe actualizado.',PICKUP_ACCESS_DENIED:'No tienes permiso para gestionar estos informes.',PICKUP_REPORT_NOT_FOUND:'No se encuentra el informe en esta empresa.',PICKUP_BUSY:'El informe tiene una operación en curso. Vuelve a intentarlo en un momento.',PICKUP_CARRIER_ALREADY_SIGNED:'Este transportista ya tiene una firma registrada.',PICKUP_REPORT_VOID:'El informe está anulado. Crea uno nuevo.',PICKUP_PII_PURGED:'Los datos de firma han vencido o se han eliminado por retención.',PICKUP_REQUEST_REUSED:'El intento anterior contiene otros datos. Cierra y vuelve a abrir el formulario.',PICKUP_STAMP_REQUIRED:'Configura el sello del remitente en Configuración → General antes de firmar.',PICKUP_STORAGE_UNAVAILABLE:'No se pudo guardar o recuperar el documento. Puedes reintentar la misma solicitud.',PICKUP_ARTIFACT_MISMATCH:'El archivo guardado no coincide con este intento. No se ha sobrescrito.',PICKUP_INVALID_SIGNATURE:'Revisa conductor, DNI o matrícula, fecha, bultos y firma.',PICKUP_INVALID_MAIL:'Revisa destinatario, asunto y mensaje.',PICKUP_MAIL_RATE_LIMIT:'Has alcanzado el límite de correos. Inténtalo más tarde.',PICKUP_MAIL_UNCERTAIN:'Gmail no confirmó el resultado. Revisa Enviados antes de volver a enviar.',PICKUP_GMAIL_DENIED:'Gmail no autorizó el envío. Renueva el permiso de Google.',PICKUP_OWNER_EMAIL_UNAVAILABLE:'No se pudo resolver el correo del propietario. Revisa sus datos o desmarca la copia.',PICKUP_VOID_REASON_REQUIRED:'Indica el motivo de anulación.',PICKUP_FAILED:'No se pudo completar la operación del informe.'};
class PickupError extends Error{constructor(readonly code:string,readonly status=409){super(code)}}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'private, no-store'}});
const validId=(value:unknown)=>typeof value==='string'&&uuid.test(value);
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
export const pickupDigest=async(bytes:Uint8Array)=>hex(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));
const textDigest=(value:unknown)=>pickupDigest(new TextEncoder().encode(JSON.stringify(value)));
function base64(bytes:Uint8Array){let result='';for(let i=0;i<bytes.length;i+=0x8000)result+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(result)}
const imageMime=(b:Uint8Array)=>b[0]===137&&b[1]===80?'image/png':b[0]===255&&b[1]===216?'image/jpeg':String.fromCharCode(...b.slice(8,12))==='WEBP'?'image/webp':null;
const imageUrl=(bytes:Uint8Array)=>{const mime=imageMime(bytes);if(!mime)throw new PickupError('PICKUP_STAMP_REQUIRED');return `data:${mime};base64,${base64(bytes)}`};
async function readBody(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new PickupError('PICKUP_INVALID_SIGNATURE',400);let count=0,text='';const decoder=new TextDecoder();
 try{while(true){const part=await reader.read();if(part.done)break;count+=part.value.length;if(count>750000){await reader.cancel();throw new PickupError('PICKUP_INVALID_SIGNATURE',413)}text+=decoder.decode(part.value,{stream:true})}return JSON.parse(text+decoder.decode())}catch(e){if(e instanceof PickupError)throw e;throw new PickupError('PICKUP_INVALID_SIGNATURE',400)}finally{reader.releaseLock()}
}
function normalizeSignature(value:any){
 if(!value||typeof value!=='object')throw new PickupError('PICKUP_INVALID_SIGNATURE',400);
 const carrier=String(value.carrier||'').trim(),driverName=String(value.driverName||'').trim(),identifier=String(value.identifier||'').trim(),receivedAt=String(value.receivedAt||''),packages=Number(value.packages),dataUrl=String(value.signatureDataUrl||'');
 if(!carrier||carrier.length>120||driverName.length<2||driverName.length>120||identifier.length<2||identifier.length>40||/[\u0000-\u001f]/.test(driverName+identifier)||!/^\d{4}-\d\d-\d\dT/.test(receivedAt)||!Number.isFinite(Date.parse(receivedAt))||!Number.isInteger(packages)||packages<1||packages>200000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)||dataUrl.length>600000)throw new PickupError('PICKUP_INVALID_SIGNATURE',400);
 const binary=atob(dataUrl.split(',')[1]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 if(bytes.length<33||bytes.length>450000||imageMime(bytes)!=='image/png')throw new PickupError('PICKUP_INVALID_SIGNATURE',400);
 const view=new DataView(bytes.buffer),w=view.getUint32(16),h=view.getUint32(20);if(w<32||h<16||w>2400||h>1600||w*h>3_000_000)throw new PickupError('PICKUP_INVALID_SIGNATURE',400);
 return {carrier,driverName,identifier,receivedAt:new Date(receivedAt).toISOString(),packages,bytes};
}
export function createPickupDocumentHandler(deps:Dependencies){
 const admin=deps.admin,fetcher=deps.fetch||fetch;
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw error;return data};
 const objectRead=async(store:string,path:string,optional=false):Promise<Uint8Array|null>=>{
  const {data,error}=await admin.storage.from(store).download(path);
  if(error||!data){if(optional&&(String(error?.statusCode)==='404'||/not found|does not exist/i.test(String(error?.message||''))))return null;throw new PickupError('PICKUP_STORAGE_UNAVAILABLE',503)}return new Uint8Array(await data.arrayBuffer());
 };
 const put=async(path:string,bytes:Uint8Array,contentType:string)=>{
  if(!bytes.length||bytes.length>5*1024*1024)throw new PickupError('PICKUP_STORAGE_UNAVAILABLE',413);
  const {error}=await admin.storage.from(bucket).upload(path,bytes,{upsert:false,contentType,cacheControl:'0'});
  if(error&&String(error.statusCode)!=='409'&&!/already exists|duplicate/i.test(String(error.message||'')))throw new PickupError('PICKUP_STORAGE_UNAVAILABLE',503);
  const saved=await objectRead(bucket,path);if(await pickupDigest(saved!)!==await pickupDigest(bytes))throw new PickupError('PICKUP_ARTIFACT_MISMATCH');
 };
 const ownedPath=(owner:string,report:string,path:string)=>{if(!path.startsWith(owner+'/'+report+'/')||path.includes('..'))throw new PickupError('PICKUP_ARTIFACT_MISMATCH');return path};
 const branding=async(owner:string,report:string,root:string,bundle:any)=>{
  let stampPath=bundle.stampPath||root+'/stamp.png',logoPath=bundle.logoPath||null;
  let stamp=await objectRead(bucket,ownedPath(owner,report,stampPath),!bundle.stampPath),logo:Uint8Array|null=null;
  if(bundle.logoPath)logo=await objectRead(bucket,ownedPath(owner,report,bundle.logoPath));
  if(!stamp){
   const {data,error}=await admin.from('company_branding').select('stamp_path,logo_path').eq('owner_id',owner).maybeSingle();
   if(error)throw new PickupError('PICKUP_STORAGE_UNAVAILABLE',503);
   const source=String(data?.stamp_path||'');if(!source.startsWith(owner+'/')||source.includes('..'))throw new PickupError('PICKUP_STAMP_REQUIRED');
   stamp=await objectRead('company-assets',source);const mime=imageMime(stamp!);if(!mime)throw new PickupError('PICKUP_STAMP_REQUIRED');await put(stampPath,stamp!,mime);
   if(data?.logo_path){const path=String(data.logo_path);if(path.startsWith(owner+'/')&&!path.includes('..')){logo=await objectRead('company-assets',path,true);if(logo&&imageMime(logo)){logoPath=root+'/logo.png';await put(logoPath,logo,imageMime(logo)!)}else logo=null}}
  }else if(!bundle.stampPath&&!bundle.logoPath){const previous=await objectRead(bucket,root+'/logo.png',true);if(previous){logo=previous;logoPath=root+'/logo.png'}}
  return {stampPath,logoPath,stampDataUrl:imageUrl(stamp!),logoDataUrl:logo?imageUrl(logo):null};
 };
 const signedOptions=async(owner:string,report:string,bundle:any)=>{
  if(bundle.state?.piiExpired||bundle.state?.piiPurgedAt)throw new PickupError('PICKUP_PII_PURGED');
  const signatures:PickupPdfSignature[]=await Promise.all((bundle.signatures||[]).map(async(s:any)=>({...s,signatureDataUrl:imageUrl((await objectRead(bucket,ownedPath(owner,report,s.signaturePath)))!)})));
  return signatures;
 };
 const pdfFor=async(caller:Caller,report:string,requestId:string,bundle?:any)=>{
  const b=bundle||await rpc('pickup_document_read',{p_owner:caller.data_owner_id,p_actor:caller.user_id,p_report:report});
  if(b.state.piiExpired&&!b.state.piiPurgedAt)throw new PickupError('PICKUP_PII_PURGED');
  if(b.pdfPath){const bytes=await objectRead(bucket,ownedPath(caller.data_owner_id,report,b.pdfPath));if(b.pdfHash&&await pickupDigest(bytes!)!==b.pdfHash)throw new PickupError('PICKUP_ARTIFACT_MISMATCH');return {bytes:bytes!,number:b.report.number}}
  let stamp:Uint8Array|null=null,logo:Uint8Array|null=null;
  try{
   const {data}=await admin.from('company_branding').select('stamp_path,logo_path').eq('owner_id',caller.data_owner_id).maybeSingle();
   const read=async(path:string|null)=>path?.startsWith(caller.data_owner_id+'/')&&!path.includes('..')?await objectRead('company-assets',path,true):null;
   [stamp,logo]=await Promise.all([read(data?.stamp_path),read(data?.logo_path)]);
  }catch{/* Optional branding never blocks an unsigned printable report. Signed PDFs above never fall back. */}
  const bytes=createPickupReportDocument(b.report,()=>deps.makeDocument(new Date(),requestId.replaceAll('-','')),{stampDataUrl:stamp?imageUrl(stamp):null,logoDataUrl:logo?imageUrl(logo):null});
  return {bytes,number:b.report.number};
 };
 return async(request:Request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors});if(request.method!=='POST')return json({error:'Método no permitido.'},405);
  let signing:{owner:string;actor:string;report:string;request:string;lease:string}|null=null;
  try{
   const caller=await deps.authenticate(request,admin);if(!caller.active||caller.role!=='admin'&&!caller.permissions?.includes('orders'))throw new PickupError('PICKUP_ACCESS_DENIED',403);
   const body=await readBody(request),scope={p_owner:caller.data_owner_id,p_actor:caller.user_id};
   if(body.action==='statuses'){if(!Array.isArray(body.ids)||body.ids.length>50||body.ids.some((id:unknown)=>!validId(id)))throw new PickupError('PICKUP_INVALID_SIGNATURE',400);return json({ok:true,states:await rpc('pickup_document_statuses',{...scope,p_reports:body.ids})})}
   if(!validId(body.reportId))throw new PickupError('PICKUP_INVALID_SIGNATURE',400);
   if(body.action==='sign'){
    if(!validId(body.requestId))throw new PickupError('PICKUP_INVALID_SIGNATURE',400);
    const normalized=normalizeSignature(body.input),signatureHash=await pickupDigest(normalized.bytes),{bytes,...fields}=normalized,input={...fields,signatureHash,inputHash:await textDigest({...fields,signatureHash})},lease=crypto.randomUUID();
    const prepared=await rpc('pickup_document_prepare',{...scope,p_report:body.reportId,p_request:body.requestId,p_lease:lease,p_input:input});
    if(prepared.status==='completed')return json({ok:true,state:prepared.state});
    signing={owner:caller.data_owner_id,actor:caller.user_id,report:body.reportId,request:body.requestId,lease};
    const root=caller.data_owner_id+'/'+body.reportId+'/'+body.requestId,brand=await branding(caller.data_owner_id,body.reportId,root,prepared.bundle);
    await put(ownedPath(caller.data_owner_id,body.reportId,prepared.signaturePath),bytes,'image/png');
    const signatures=await signedOptions(caller.data_owner_id,body.reportId,prepared.bundle);signatures.push({...fields,signatureDataUrl:`data:image/png;base64,${base64(bytes)}`});
    const generatedAt=new Date(prepared.createdAt),pdf=createPickupReportDocument(prepared.bundle.report,()=>deps.makeDocument(generatedAt,body.requestId.replaceAll('-','')),{...brand,signatures,generatedAt,requireStamp:true});
    await put(ownedPath(caller.data_owner_id,body.reportId,prepared.pdfPath),pdf,'application/pdf');
    const state=await rpc('pickup_document_complete',{...scope,p_report:body.reportId,p_request:body.requestId,p_lease:lease,p_artifact:{pdfHash:await pickupDigest(pdf),stampPath:brand.stampPath,logoPath:brand.logoPath}});signing=null;return json({ok:true,state});
   }
   if(body.action==='void'){const state=await rpc('pickup_document_void',{...scope,p_report:body.reportId,p_reason:String(body.reason||'')});return json({ok:true,state})}
   if(body.action==='mail_history')return json({ok:true,entries:await rpc('pickup_document_mail_list',{...scope,p_report:body.reportId})});
   if(body.action==='pdf'){
    const pdf=await pdfFor(caller,body.reportId,crypto.randomUUID());return new Response(new Uint8Array(pdf.bytes),{headers:{...cors,'Content-Type':'application/pdf','Cache-Control':'private, no-store','Content-Disposition':`attachment; filename="${String(pdf.number).replace(/[^A-Za-z0-9_-]+/g,'_')}.pdf"`}});
   }
   if(body.action==='mail'){
    const to=String(body.to||'').trim().toLowerCase(),subject=String(body.subject||'').trim(),text=String(body.body||''),token=String(body.gmailToken||'');
    if(!validId(body.requestId)||!validMailAddress(to)||!subject||subject.length>200||/[\r\n]/.test(subject)||text.length>10000||token.length<10||token.length>4000)throw new PickupError('PICKUP_INVALID_MAIL',400);
    let cc:string|undefined;if(body.ccOwner===true){const {data,error}=await admin.auth.admin.getUserById(caller.data_owner_id);if(error||!validMailAddress(data?.user?.email||''))throw new PickupError('PICKUP_OWNER_EMAIL_UNAVAILABLE');cc=data.user.email}
    const reservation=await rpc('pickup_document_mail_prepare',{...scope,p_report:body.reportId,p_request:body.requestId,p_to:to,p_input_hash:await textDigest({to,subject,text,cc:cc||null}),p_cc_owner:body.ccOwner===true,p_subject:subject});
    if(!reservation.retry)return json({ok:true,...reservation});
    let outcome='failed',messageId:string|null=null,errorCode='GMAIL_FAILED',providerStarted=false;
    try{
     const pdf=await pdfFor(caller,body.reportId,body.requestId);if(pdf.bytes.length>5*1024*1024)throw new PickupError('PICKUP_INVALID_MAIL',413);
     const raw=buildGmailPdfMessage({to,cc,subject,body:text,pdf:pdf.bytes,filename:String(pdf.number).replace(/[^A-Za-z0-9_-]+/g,'_')+'.pdf'});
     providerStarted=true;const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(30000)});
     if(response.ok){const result=await response.json();if(typeof result.id==='string'&&result.id.length<=200){outcome='sent';messageId=result.id;errorCode=''}else{outcome='unknown';errorCode='NETWORK_UNCERTAIN'}}
     else if(response.status>=500){outcome='unknown';errorCode='NETWORK_UNCERTAIN'}else{outcome='failed';errorCode=response.status===401||response.status===403?'GMAIL_DENIED':'GMAIL_FAILED'}
    }catch{outcome=providerStarted?'unknown':'failed';errorCode=providerStarted?'NETWORK_UNCERTAIN':'GMAIL_FAILED'}
    try{await rpc('pickup_document_mail_finish',{...scope,p_request:body.requestId,p_status:outcome,p_message_id:messageId,p_error_code:errorCode})}catch{throw new PickupError('PICKUP_MAIL_UNCERTAIN')}
    return json({ok:true,status:outcome,messageId,code:errorCode});
   }
   throw new PickupError('PICKUP_INVALID_SIGNATURE',400);
  }catch(error){
   if(signing)try{await rpc('pickup_document_release',{p_owner:signing.owner,p_actor:signing.actor,p_report:signing.report,p_request:signing.request,p_lease:signing.lease})}catch{/* Expiry recovers a lease even if this release is unavailable. */}
   const raw=error instanceof Error?error.message:String((error as any)?.message||''),mfa=/MFA_[A-Z_]+/.exec(raw)?.[0];
   if(mfa)return json({error:mfa,code:mfa},403);
   if(/Sesión no válida/.test(raw))return json({error:'Tu sesión no es válida. Vuelve a entrar.',code:'AUTH_REQUIRED'},401);
   const code=error instanceof PickupError?error.code:/PICKUP_[A-Z_]+/.exec(raw)?.[0]||'PICKUP_FAILED',status=error instanceof PickupError?error.status:code==='PICKUP_ACCESS_DENIED'?403:409;
   return json({error:messages[code]||messages.PICKUP_FAILED,code},status);
  }
 };
}
