import {supabase} from './supabase';

export type VerifactuIntegrityReport={
 checkedAt:string;mode:'disabled'|'shadow';status:'empty'|'ok'|'broken';recordCount:number;altaCount:number;cancellationCount:number;eventCount:number;
 issueCount:number;issuesTruncated:boolean;issues:{code:string;sequence:number;recordId?:string;eventId?:string}[];
 days:{day:string;altas:number;cancellations:number}[];
 recent:{id:string;invoiceId:string;sequence:number;kind:'alta'|'anulacion';hash:string;generatedAt:string}[];aeatConnected:false;
};
export async function loadVerifactuIntegrityReport():Promise<VerifactuIntegrityReport>{
 const {data,error}=await supabase.rpc('verifactu_integrity_report');
 if(error)throw error;
 const r=data as VerifactuIntegrityReport|null;
 if(!r||!['empty','ok','broken'].includes(r.status)||!['disabled','shadow'].includes(r.mode)||!Array.isArray(r.issues)||!Array.isArray(r.days)||!Array.isArray(r.recent)||r.aeatConnected!==false||![r.recordCount,r.altaCount,r.cancellationCount,r.eventCount,r.issueCount].every(x=>Number.isSafeInteger(x)&&x>=0)||!Number.isFinite(Date.parse(r.checkedAt))||r.recordCount!==r.altaCount+r.cancellationCount||(r.issueCount>0)!==(r.status==='broken')||r.issues.length>r.issueCount||(r.status==='empty'&&r.recordCount!==0)||(r.status==='ok'&&r.recordCount===0))throw new Error('VF_MONITOR_RESPONSE_INVALID');
 const count=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
 if(typeof r.issuesTruncated!=='boolean'||r.issues.length!==Math.min(r.issueCount,100)||r.issuesTruncated!==(r.issueCount>100)||!r.issues.every(x=>x&&typeof x.code==='string'&&count(x.sequence)&&(x.sequence>0||x.code==='CHAIN_HEAD'))||!r.days.every(x=>x&&/^\d{4}-\d{2}-\d{2}$/.test(x.day)&&count(x.altas)&&count(x.cancellations))||!r.recent.every(x=>x&&typeof x.id==='string'&&typeof x.invoiceId==='string'&&count(x.sequence)&&x.sequence>0&&['alta','anulacion'].includes(x.kind)&&/^[0-9A-F]{64}$/.test(x.hash)&&Number.isFinite(Date.parse(x.generatedAt))))throw new Error('VF_MONITOR_RESPONSE_INVALID');
 return r;
}

export const integrityIssueLabels:Record<string,string>={
 RECORD_DIGEST:'Huella del registro distinta del contenido guardado',RECORD_CANONICAL:'Campos del registro distintos de su cadena de cálculo',RECORD_LINK:'Enlace con el registro anterior incorrecto',RECORD_SEQUENCE:'Salto en la secuencia de registros',CHAIN_HEAD:'La cabeza guardada no coincide con la cadena',CANCELLATION_ALTA:'Anulación sin alta original válida',EVENT_DIGEST:'Huella de evento incorrecta',EVENT_FIELDS:'Contenido de evento incoherente',EVENT_LINK:'Enlace de evento incorrecto',EVENT_SEQUENCE:'Salto en la secuencia de eventos',
};
