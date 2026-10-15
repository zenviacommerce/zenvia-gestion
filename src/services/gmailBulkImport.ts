import type {GmailCandidate} from './gmail';
import type {GmailImportOutcome} from './gmailImport';
import {errorMessage} from './toast';

export async function runGmailImportBatch(
 candidates:GmailCandidate[],
 importer:(candidate:GmailCandidate)=>Promise<GmailImportOutcome>,
 onStart?:(candidate:GmailCandidate,index:number,total:number)=>void,
){
 const seen=new Set<string>();
 const pending=candidates.filter(candidate=>{
  if(!candidate.id||seen.has(candidate.id)||!['found','error'].includes(candidate.status))return false;
  seen.add(candidate.id);return true;
 });
 let imported=0;
 const reviews:Array<{source:GmailCandidate;candidate:Extract<GmailImportOutcome,{kind:'review'}>['candidate']}>=[];
 const failures:Array<{source:GmailCandidate;message:string}>=[];
 // Keep concurrency deliberately low: PDF extraction is expensive and suppliers may
 // share products. The importer still owns duplicate verification before persistence.
 const concurrency=Math.min(2,pending.length);
 let cursor=0;
 const workers=Array.from({length:concurrency},async()=>{
  while(cursor<pending.length){
   const index=cursor++;
   const source=pending[index];
   onStart?.(source,index+1,pending.length);
   try{
    const result=await importer(source);
    if(result.kind==='review')reviews.push({source,candidate:result.candidate});
    else imported++;
   }catch(error){failures.push({source,message:errorMessage(error,'No se pudo importar este adjunto.')});}
  }
 });
 await Promise.all(workers);
 return {imported,reviews,failures};
}
