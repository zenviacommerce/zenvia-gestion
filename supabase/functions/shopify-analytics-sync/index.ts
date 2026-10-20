import { createAdminClient, authenticateUser, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { shopifyAccountCredentials, shopifyStoredApplicationCredentials, shopifyError } from '../_shared/shopifyAuth.ts';
import { normalizeShopifyAnalyticsOrder, shopifyAnalyticsCallerAllowed } from '../_shared/shopifyAnalyticsFinance.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{headers,status});
const money='shopMoney { amount currencyCode }';
const pageInfo='pageInfo { hasNextPage endCursor }';
const lineFields=`id name sku quantity requiresShipping variant {id} image {url} originalTotalSet {${money}} discountAllocations {allocatedAmountSet {${money}}} discountedTotalSet {${money}} taxLines {priceSet {${money}}}`;
const refundLineFields=`quantity subtotalSet {${money}} totalTaxSet {${money}} lineItem {id sku variant {id}}`;
const transactionFields='status kind';
const refundShippingFields=`taxAmountSet {${money}}`;
const adjustmentFields=`taxAmountSet {${money}}`;
const refundFields=`id createdAt totalRefundedSet {${money}} transactions(first:100) {${pageInfo} nodes {${transactionFields}}} refundLineItems(first:100) {${pageInfo} nodes {${refundLineFields}}} refundShippingLines(first:100) {${pageInfo} nodes {${refundShippingFields}}} orderAdjustments(first:100) {${pageInfo} nodes {${adjustmentFields}}}`;
const orderFields=`id legacyResourceId createdAt processedAt updatedAt cancelledAt test taxesIncluded displayFinancialStatus totalPriceSet {${money}} totalTaxSet {${money}} totalDiscountsSet {${money}} totalShippingPriceSet {${money}} lineItems(first:100) {${pageInfo} nodes {${lineFields}}} refunds {id}`;
async function gql(c:any,query:string,variables:Record<string,unknown>={}){
 for(let attempt=0;attempt<5;attempt++){
  const r=await fetch(`https://${c.shopDomain}/admin/api/${c.apiVersion}/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':c.accessToken},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000),redirect:'error'});
  const p=await r.json().catch(()=>({}));
  if(r.status===429||p.errors?.some((e:any)=>e.extensions?.code==='THROTTLED')){await new Promise(resolve=>setTimeout(resolve,Math.min(5000,1000*2**attempt)));continue;}
  if(!r.ok||p.errors?.length)throw new Error(`Shopify (${r.status}): ${p.errors?.map((e:any)=>e.message).join(' · ')||'No se pudo consultar la tienda.'}`);
  return p.data;
 }
 throw new Error('Shopify limita temporalmente las consultas. Vuelve a sincronizar.');
}
async function complete(c:any,node:any,field:string,fields:string,type='Order'){
 const connection=node[field];if(!connection)return;
 while(connection.pageInfo?.hasNextPage){
  const data=await gql(c,`query($id:ID!,$after:String){node(id:$id){... on ${type}{${field}(first:100,after:$after){${pageInfo} nodes{${fields}}}}}}`,{id:node.id,after:connection.pageInfo.endCursor});
  const next=data.node?.[field];if(!next||next.pageInfo?.hasNextPage&&(!next.pageInfo.endCursor||next.pageInfo.endCursor===connection.pageInfo.endCursor))throw new Error('Shopify no devolvió una página financiera completa.');
  connection.nodes.push(...next.nodes);connection.pageInfo=next.pageInfo;
 }
}
async function save(admin:any,table:string,rows:any[],onConflict:string){
 if(!rows.length)return;
 const r=await admin.from(table).upsert(rows,{onConflict});if(r.error)throw r.error;
}
async function syncStore(admin:any,account:any,history:boolean,target:string,source:string,receivedAt:string,runStartedAt:string){
 const owner=account.owner_id,store=account.id,lease=crypto.randomUUID();
 const claimed=await admin.rpc('shopify_analytics_claim_sync',{owner,store,lease});if(claimed.error)throw claimed.error;
 if(!claimed.data)return {id:store,name:account.display_name,synced:0,skipped:true};
 const leaseStarted=Date.now();
 const updateState=async(row:any)=>{const result=await admin.from('shopify_analytics_sync_state').update(row).eq('owner_id',owner).eq('integration_account_id',store).eq('sync_lease',lease).select('integration_account_id').maybeSingle();if(result.error)throw result.error;if(!result.data)throw new Error('La sincronización perdió su bloqueo.');};
 try{
 const {data:state,error:stateError}=await admin.from('shopify_analytics_sync_state').select('*').eq('integration_account_id',store).maybeSingle();if(stateError)throw stateError;
 if(!target)await updateState({status:'syncing',error:null});
 const c=await shopifyAccountCredentials(admin,account,await shopifyStoredApplicationCredentials(admin,owner));
  const scopeData=await gql(c,'{currentAppInstallation{accessScopes{handle}}}');
  const scopes=new Set<string>((scopeData.currentAppInstallation?.accessScopes||[]).map((s:any)=>s.handle));
  const catalogAvailable=scopes.has('read_products')||scopes.has('write_products');
  const inventoryAvailable=catalogAvailable&&(scopes.has('read_inventory')||scopes.has('write_inventory'));
  let variantsAccessible=true;
  let scopedLineFields=lineFields;
  let scopedRefundLineFields=refundLineFields;
  let scopedOrderFields=orderFields;
  let scopedRefundFields=refundFields;
  const allHistory=!target&&(history||!state?.last_synced_at||state?.history_complete===false);
  const changedAfter=state?.last_synced_at?new Date(new Date(state.last_synced_at).getTime()-2*86400000).toISOString():null;
  const query=target?`id:${target}`:allHistory?`updated_at:<=${runStartedAt}`:`updated_at:>=${changedAfter} updated_at:<=${runStartedAt}`;
  let after:string|null=allHistory&&!history?state?.orders_cursor||null:null;
  let count=0;let hasNext=false;const started=Date.now();
  do{
   const data=await gql(c,`query($after:String,$query:String){orders(first:25,after:$after,sortKey:UPDATED_AT,query:$query){${pageInfo} nodes{id}}}`,{after,query});
   const connection=data.orders;
   for(const remote of connection.nodes){
    let full:any;
    try{full=await gql(c,`query($id:ID!){order(id:$id){${scopedOrderFields}}}`,{id:remote.id});}
    catch(error){
     if(!variantsAccessible||!/access denied.*variant|access.*read_products/i.test(shopifyError(error)))throw error;
     variantsAccessible=false;scopedLineFields=lineFields.replace('variant {id}','');scopedRefundLineFields=refundLineFields.replace('variant {id}','');scopedOrderFields=orderFields.replace('variant {id}','');scopedRefundFields=refundFields.replace('variant {id}','');
     full=await gql(c,`query($id:ID!){order(id:$id){${scopedOrderFields}}}`,{id:remote.id});
    }
    const order=full.order;if(!order)throw new Error('Shopify: pedido solicitado no encontrado.');
    order.legacyResourceId=String(order.legacyResourceId||String(order.id).split('/').pop());
    if(target&&order.legacyResourceId!==target)throw new Error('Shopify devolvió un pedido distinto al solicitado.');
    await complete(c,order,'lineItems',scopedLineFields);
    for(let index=0;index<(order.refunds||[]).length;index++){
     const refundData=await gql(c,`query($id:ID!){refund(id:$id){${scopedRefundFields}}}`,{id:order.refunds[index].id});
     const refund=refundData.refund;if(!refund)throw new Error('Shopify no devolvió una devolución completa.');
     order.refunds[index]=refund;
     await complete(c,refund,'transactions',transactionFields,'Refund');
     await complete(c,refund,'refundLineItems',scopedRefundLineFields,'Refund');
     await complete(c,refund,'refundShippingLines',refundShippingFields,'Refund');
     await complete(c,refund,'orderAdjustments',adjustmentFields,'Refund');
    }
    const normalized=normalizeShopifyAnalyticsOrder(order,owner,store);
    const result=await admin.rpc('shopify_analytics_ingest',{snapshot:normalized,lease});if(result.error)throw result.error;
    const traced=await admin.rpc('shopify_record_order_ingestion',{owner,store,remote_order_id:order.legacyResourceId,remote_created_at:order.createdAt,destination:'analytics',source,received_at:receivedAt});if(traced.error)throw traced.error;count++;
   }
   const previousCursor=after;after=connection.pageInfo.endCursor;hasNext=connection.pageInfo.hasNextPage;
   if(hasNext&&(!after||after===previousCursor))throw new Error('Shopify no devolvió una página completa.');
   // Stop only after complete order pages; the next run resumes history at this cursor.
   if(allHistory&&hasNext&&Date.now()-started>70000)break;
  }while(hasNext);
  if(target){if(!count)throw new Error('Shopify: pedido solicitado no encontrado.');return {id:store,name:account.display_name,synced:count};}
  if(catalogAvailable&&!hasNext){
   const generation=crypto.randomUUID();
   let cursor:string|null=null;
   do{
    const fields=`id sku title image{url} product{title featuredImage{url}} ${inventoryAvailable?'inventoryQuantity inventoryItem{tracked}':''}`;
    const data=await gql(c,`query($after:String){productVariants(first:100,after:$after){${pageInfo} nodes{${fields}}}}`,{after:cursor});
    const connection=data.productVariants;
    const rows=connection.nodes.map((variant:any)=>({owner_id:owner,integration_account_id:store,variant_id:variant.id,seller_sku:variant.sku||variant.id,name:[variant.product?.title,variant.title==='Default Title'?null:variant.title].filter(Boolean).join(' · '),image_url:variant.image?.url||variant.product?.featuredImage?.url||null,inventory_quantity:inventoryAvailable&&variant.inventoryItem?.tracked?variant.inventoryQuantity:null,sync_generation:generation}));
    const saved=await admin.rpc('shopify_analytics_catalog_batch',{owner,store,lease,rows});if(saved.error)throw saved.error;
    cursor=connection.pageInfo.hasNextPage?connection.pageInfo.endCursor:null;
   }while(cursor);
   const finished=await admin.rpc('shopify_analytics_finish_catalog',{owner,store,generation,lease});if(finished.error)throw finished.error;
  }
  if(Date.now()-leaseStarted>240000)throw new Error('La sincronización excedió el tiempo permitido. Vuelve a sincronizar.');
  if(!inventoryAvailable){const result=await admin.rpc('shopify_analytics_invalidate_inventory',{owner,store,lease});if(result.error)throw result.error;}
  const {data:earliest,error:earliestError}=await admin.from('shopify_analytics_orders').select('event_at').eq('owner_id',owner).eq('integration_account_id',store).order('event_at').limit(1);if(earliestError)throw earliestError;
  await updateState({status:hasNext?'partial':'ready',last_synced_at:hasNext?state?.last_synced_at||null:runStartedAt,available_from:earliest?.[0]?.event_at||null,inventory_available:inventoryAvailable,catalog_available:catalogAvailable,history_limited:!scopes.has('read_all_orders'),orders_cursor:allHistory&&hasNext?after:null,history_complete:!hasNext,error:hasNext?'Importación histórica en curso; continuará automáticamente.':null});
  return {id:store,name:account.display_name,synced:count,partial:hasNext,inventoryAvailable,catalogAvailable};
 }catch(error){
  const message=shopifyError(error);if(!target)await updateState({status:'error',error:message.slice(0,900)});
  return {id:store,name:account.display_name,synced:0,error:message};
 }finally{await admin.rpc('shopify_analytics_release_sync',{owner,store,lease});}
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return reply({ok:true});if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
 const admin=createAdminClient();
 try{
  const runStartedAt=new Date().toISOString();
  const body=await req.json().catch(()=>({}));let owner:string;
  const internal=Object.prototype.hasOwnProperty.call(body,'ownerId');
  if(internal){requireInternalSecret(req);owner=String(body.ownerId||'');
   if(!owner||!body.integrationAccountId||!['webhook','cron'].includes(body.syncSource))throw new Error('Llamada interna no autorizada.');
   const {data:workspace,error}=await admin.from('workspaces').select('status').eq('id',owner).maybeSingle();if(error)throw error;
   if(!workspace||!['active','trialing'].includes(workspace.status))throw new Error('El acceso de tu empresa está suspendido.');
  }
  else{const caller=await authenticateUser(req,admin);if(!shopifyAnalyticsCallerAllowed(caller))return reply({error:'No tienes permiso de Shopify.'},403);owner=caller.data_owner_id;}
  const target=internal?String(body.orderId||'').trim():'';if(target&&!/^\d+$/.test(target))throw new Error('ID de pedido Shopify inválido.');
  const source=internal?body.syncSource:'manual';const receivedAt=internal&&body.receivedAt?new Date(body.receivedAt).toISOString():runStartedAt;
  let q=admin.from('integration_accounts').select('*').eq('owner_id',owner).eq('provider','shopify').eq('enabled',true).neq('status','disabled').neq('credential_source','derived');
  if(body.integrationAccountId)q=q.eq('id',body.integrationAccountId);
  const {data:accounts,error}=await q;if(error)throw error;if(internal&&!accounts?.length)throw new Error('Cuenta Shopify no disponible.');
  const results:any[]=[];for(const a of accounts||[]){try{results.push(await syncStore(admin,a,Boolean(body.history),target,source,receivedAt,runStartedAt));}catch(error){results.push({id:a.id,name:a.display_name,synced:0,error:shopifyError(error)});}}
  return reply({skipped:results.some(r=>'skipped' in r&&r.skipped),ok:results.every(r=>!r.error),configured:Boolean(accounts?.length),synced:results.reduce((n,r)=>n+r.synced,0),stores:results.length,errors:results.filter(r=>'error' in r),accounts:results});
 }catch(error){return reply({error:shopifyError(error)},String(shopifyError(error)).includes('Sesión')||String(shopifyError(error)).includes('autorizada')?401:403);}
});
