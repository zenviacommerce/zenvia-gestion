import type {ImportItem,ImportOutcome} from './contracts.ts';
import {errorOutcome} from './state.ts';
export async function runImportBatch(repository:{claim:()=>Promise<ImportItem[]>;finish:(item:ImportItem,outcome:ImportOutcome)=>Promise<boolean>},execute:(item:ImportItem)=>Promise<ImportOutcome>){
 const items=await repository.claim();let committed=0;
 await Promise.all(items.map(async item=>{
  let outcome:ImportOutcome;
  try{outcome=await execute(item)}catch(error){outcome=errorOutcome(error,item.attempts,item.max_attempts)}
  try{if(await repository.finish(item,outcome))committed++;}catch{/* Keep the unacknowledged lease for recovery; other items still finish. */}
 }));
 return {claimed:items.length,committed};
}
