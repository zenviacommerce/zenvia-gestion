// Never persist webhook payloads: the existing importers fetch authoritative snapshots.
export async function verifyOrderWebhook(raw:Uint8Array,signature:string,secret:string){
 if(!secret||!signature||!/^[A-Za-z0-9+/]{43}=$/.test(signature))return false;
 try{const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),raw);}catch{return false;}
}
export function shopMatches(header:string,domain:string){return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(header)&&header===domain.toLowerCase();}
export function webhookMetadata(payload:any,topic:string,delivery:string){
 const gid=String(payload?.admin_graphql_api_id||'').match(/^gid:\/\/shopify\/Order\/(\d+)$/);
 const id=gid?gid[1]:typeof payload?.id==='number'&&!Number.isSafeInteger(payload.id)?'':String(payload?.id||'');
 if(!/^\d{1,30}$/.test(id)||!['orders/create','orders/updated'].includes(topic)||!delivery||delivery.length>200)throw new Error('Invalid webhook metadata');
 const created=payload.created_at?new Date(payload.created_at):null;
 if(created&&!Number.isFinite(created.getTime()))throw new Error('Invalid webhook timestamp');
 return {order_id:id,topic,delivery_id:delivery,shopify_created_at:created?.toISOString()||null};
}
export function importCompleted(result:any){return result?.ok===true&&result.configured!==false&&!result.skipped&&!result.partial&&!result.error&&!(result.errors?.length)&&!(result.accounts||[]).some((a:any)=>a.skipped||a.partial||a.error);}
