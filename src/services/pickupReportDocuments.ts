import {getActiveSupabase,getActiveTenant} from './supabase';
import {authorizeGmailSend,cachedGmailReconcileToken} from './gmailSender';
export type PickupDocumentStatus={id:string;status:'pending'|'partial'|'signed'|'void';revision:number;carriers?:string[];signatures:Array<{carrier:string;signedAt:string;signedBy:string;packages:number;actorName?:string|null}>;signedAt?:string|null;signedBy?:string|null;voidedAt?:string|null;voidedBy?:string|null;voidReason?:string|null;piiPurgedAt?:string|null;piiExpired?:boolean;retentionUntil?:string|null;pdfAvailable?:boolean};
export type PickupSignatureInput={carrier:string;driverName:string;identifier:string;receivedAt:string;packages:number;signatureDataUrl:string;verifiedOrderIds:string[];reportRevision:number};
export type PickupMailInput={reportId:string;requestId:string;to:string;subject:string;body:string;ccOwner:boolean};
export type PickupMailEntry={requestId:string;to:string|null;subject:string|null;ccOwner:boolean;status:'sending'|'sent'|'failed'|'unknown';createdAt:string;finishedAt?:string|null;actorId:string;reconcileRequired?:boolean;errorCode?:string;checkedAt?:string|null};
type Scope={client:ReturnType<typeof getActiveSupabase>;workspace:string|undefined};
const scope=():Scope=>({client:getActiveSupabase(),workspace:getActiveTenant()?.workspace_id});
function check(start:Scope){if(start.client!==getActiveSupabase()||start.workspace!==getActiveTenant()?.workspace_id)throw Error('La empresa o sesión ha cambiado. Vuelve a abrir el informe.')}
export class PickupDocumentError extends Error{constructor(message:string,readonly code?:string){super(message)}}
async function invoke<T>(body:Record<string,unknown>,start=scope(),binary=false):Promise<T>{
 check(start);const {data,error}=await start.client.functions.invoke('pickup-report-documents',{body});check(start);
 if(error){let detail:any;try{detail=await error.context?.clone().json()}catch{/* Sanitized generic fallback below. */}throw new PickupDocumentError(detail?.error||'No se pudo completar la operación del informe.',detail?.code)}
 if(binary){if(!(data instanceof Blob)||data.size===0)throw Error('No se pudo recuperar el PDF guardado.');return data as T}
 if(!data?.ok)throw new PickupDocumentError(data?.error||'No se pudo completar la operación del informe.',data?.code);return data as T;
}
export async function getPickupDocumentStatuses(ids:string[]){if(!ids.length)return [];return (await invoke<{ok:true;states:PickupDocumentStatus[]}>({action:'statuses',ids})).states}
export async function signPickupReport(reportId:string,input:PickupSignatureInput,requestId:string){return (await invoke<{ok:true;state:PickupDocumentStatus}>({action:'sign',reportId,input,requestId})).state}
export async function voidPickupReport(reportId:string,reason:string){return (await invoke<{ok:true;state:PickupDocumentStatus}>({action:'void',reportId,reason})).state}
export const getPickupDocumentPdf=(reportId:string)=>invoke<Blob>({action:'pdf',reportId},scope(),true);
export async function getPickupDocumentMailHistory(reportId:string){return (await invoke<{ok:true;entries:PickupMailEntry[]}>({action:'mail_history',reportId,gmailToken:cachedGmailReconcileToken()})).entries}
export async function sendPickupReportEmail(input:PickupMailInput){
 const start=scope(),gmailToken=await authorizeGmailSend(true);check(start);
 const result=await invoke<{ok:true;status:'sending'|'sent'|'failed'|'unknown';messageId?:string;code?:string;reconcileRequired?:boolean}>({action:'mail',...input,gmailToken},start);
 if(result.code==='GMAIL_DENIED'){const {clearGmailSendAuthorization}=await import('./gmailSender');clearGmailSendAuthorization()}
 return result;
}

export async function getPickupDocumentOwnerEmail(reportId:string){return (await invoke<{ok:true;email:string}>({action:'owner_email',reportId})).email}

export async function excludePickupReportItem(reportId:string,orderId:string,reason:string){const result=await invoke<{ok:true;report:import('./pickupReports').PickupReport;state:PickupDocumentStatus}>({action:'exclude_item',reportId,orderId,reason});return {...result.report,document:result.state}}

export async function reconcilePickupReportEmail(reportId:string,requestId:string){const start=scope(),gmailToken=await authorizeGmailSend(true);check(start);const result=await invoke<{ok:true;status:string;reconcileRequired?:boolean;code?:string}>({action:'reconcile_mail',reportId,requestId,gmailToken},start);if(result.code==='GMAIL_SCOPE_REQUIRED'||result.code==='GMAIL_MAILBOX_MISMATCH'){const {clearGmailSendAuthorization}=await import('./gmailSender');clearGmailSendAuthorization()}return result}
