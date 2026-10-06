import type {ImportOutcome,ItemStatus,JobStatus} from './contracts.ts';
export function summarizeItems(items:ReadonlyArray<{status:ItemStatus}>,cancelled=false){
 const count=(...states:ItemStatus[])=>items.filter(i=>states.includes(i.status)).length;
 const running=count('running'),queued=count('queued','ready'),review=count('waiting_review'),failed=count('error');
 const imported=count('imported'),skipped=count('skipped','duplicate','cancelled');
 let status:JobStatus=cancelled?'cancelled':running?'running':queued?'queued':review?'waiting_review':failed?(imported||skipped?'completed_with_errors':'failed'):'completed';
 return {status,total:items.length,processed:items.length-running-queued,imported,review,failed,skipped};
}
export function importError(error:unknown):{message:string;retryable:boolean}{
 const source=error instanceof Error?error.message:String((error as {message?:string})?.message||error||'Error de importación');
 const message=source.replace(/((?:access_token|refresh_token|authorization|apikey|secret|token)\s*[=:]\s*)([^\s,;]+)/gi,'$1[oculto]').replace(/Bearer\s+\S+/gi,'Bearer [oculto]').slice(0,1000);
 const explicit=(error as {retryable?:boolean})?.retryable;
 return {message,retryable:explicit??(/429|502|503|504|timeout|temporar|fetch failed|network|ECONN|servicio documental no disponible/i.test(source)&&!/invalid_grant|revocad|renueva|permiso|suspendid/i.test(source))};
}
export function errorOutcome(error:unknown,attempts:number,maxAttempts:number):ImportOutcome{
 const e=importError(error);return {status:e.retryable&&attempts<maxAttempts?'queued':'error',error:e.message,retryable:e.retryable,delaySeconds:Math.min(900,15*2**Math.max(0,attempts-1)),stage:e.retryable?'Esperando reintento':'Error'};
}
