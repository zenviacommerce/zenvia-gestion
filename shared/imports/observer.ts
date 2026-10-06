import type {ImportItem} from './contracts.ts';
export class ImportRequestGuard{
 private identity:string;private generation=0;
 constructor(identity:string){this.identity=identity;}
 ticket(){this.generation++;return {identity:this.identity,generation:this.generation};}
 change(identity:string){this.identity=identity;this.generation++;}
 accepts(ticket:{identity:string;generation:number}){return ticket.identity===this.identity&&ticket.generation===this.generation;}
}
export function importSubmissionLabel(stage:'uploading'|'enqueuing'|'accepted'){return stage==='uploading'?'Subiendo archivos':stage==='enqueuing'?'Registrando importación':'En segundo plano';}
export function reviewPayload(item:Pick<ImportItem,'id'|'job_id'|'version'|'status'>,candidate:Record<string,unknown>){if(item.status!=='waiting_review')throw new Error('El documento ya no está pendiente de revisión.');return {action:'review',jobId:item.job_id,itemId:item.id,version:item.version,candidate};}
