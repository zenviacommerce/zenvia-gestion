import {loadAmazonSpApiCredentials} from './amazon/config.ts';
import {spApiRequest} from './amazon/sp-api.ts';

type UnitWeight={kg:number;source:string};

type LookupBudget={remaining:number;deadline:number};
export function weightLookupBudget(remaining=4,durationMs=3500):LookupBudget{return {remaining,deadline:Date.now()+durationMs};}
const catalogCache=new Map<string,{expires:number;promise:Promise<UnitWeight|null>}>();
async function cachedCatalogWeight(key:string,fetchWeight:()=>Promise<UnitWeight|null>,budget:LookupBudget){
 const cached=catalogCache.get(key);if(cached&&cached.expires>Date.now())return cached.promise;
 if(budget.remaining<=0||budget.deadline<=Date.now())return null;
 budget.remaining--;
 let timer:ReturnType<typeof setTimeout>;
 const promise=Promise.race([fetchWeight(),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),Math.max(1,Math.min(2500,budget.deadline-Date.now())));})]).catch(()=>null).finally(()=>clearTimeout(timer));
 const entry={expires:Date.now()+5*60_000,promise};catalogCache.set(key,entry);
 if(catalogCache.size>512)catalogCache.delete(catalogCache.keys().next().value!);
 const result=await promise;entry.expires=Date.now()+(result?24*60*60_000:5*60_000);return result;
}
export function assertQuotedPackageWeight(order:any,option:any){
 const expected=positive(option?.packageWeightKg);if(!expected)return;
 const measurement=order.raw_payload?.shipping_details?.measurement?.weight,actual=weightInKg(measurement?.value,measurement?.unit);
 if(actual==null||Math.abs(actual-expected)>.0005)throw new Error('El peso ha cambiado desde la cotización. Vuelve a cotizar antes de crear la etiqueta.');
}

const positive=(value:any)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
export function weightInKg(value:any,unit:any){
 const amount=positive(value);if(amount==null)return null;
 const factors:Record<string,number>={kg:1,kilogram:1,kilograms:1,g:.001,gram:.001,grams:.001,lb:.45359237,lbs:.45359237,pound:.45359237,pounds:.45359237,oz:.028349523125,ounce:.028349523125,ounces:.028349523125};
 const factor=factors[String(unit||'').toLowerCase()];return factor?amount*factor:null;
}
export function catalogUnitWeight(catalog:any):UnitWeight|null{
 for(const key of ['item_package_weight','package_weight','item_weight'])for(const entry of catalog?.attributes?.[key]||[]){const kg=weightInKg(entry.value,entry.unit);if(kg)return {kg,source:key==='item_weight'?'amazon_item':'amazon_package'};}
 for(const dimension of catalog?.dimensions||[])for(const key of ['package','item']){const w=dimension?.[key]?.weight,kg=weightInKg(w?.value,w?.unit);if(kg)return {kg,source:'amazon_'+key};}
 return null;
}
export function canRecalculateWeight(order:any){
 if(order.pii_purged_at||order.fulfilled_at||order.label_created_at||order.shipping_remote_id||order.sendcloud_parcel_id||order.raw_payload?._zenvia_local_shipping_updated_at||order.raw_payload?._zenvia_weight?.source==='manual')return false;
 return ['pending','unshipped','pendingavailability','invoiceunconfirmed','open','unfulfilled',''].includes(String(order.source_status||'').toLowerCase().replaceAll('_',''));
}
export function calculatePackageWeight(items:any[],weights:Map<string,UnitWeight>,shipping:any){
 const lines=(Array.isArray(items)?items:[]).map(item=>{
  const sku=String(item.sku||'');let found=weights.get(sku);
  const measurement=item.measurement?.weight;const kg=weightInKg(measurement?.value,measurement?.unit)||weightInKg(item.grams,'g');
  if(!found&&kg)found={kg,source:item.weight_source||(item.grams?'shopify_grams':'item_measurement')};
  if(!found){const skuKg=positive(shipping?.skuFallbackWeightsKg?.[sku]);found={kg:skuKg||positive(shipping?.fallbackWeightKg)||1,source:skuKg?'sku_fallback':'global_fallback'};}
  const quantity=positive(item.quantity)||1;
  return {sku,quantity,unitKg:found.kg,kg:found.kg*quantity,source:found.source,estimated:found.source.endsWith('_fallback')};
 });
 return {kg:Number((lines.reduce((sum,line)=>sum+line.kg,0)||positive(shipping?.fallbackWeightKg)||1).toFixed(3)),estimated:!lines.length||lines.some(line=>line.estimated),source:'line_items',lines};
}
// This resolver changes only the request's order object. Callers persist their normal
// order patch; quotes and labels always use the identical calculation and provenance.
export async function resolveOrderPackageWeight(admin:any,order:any,shipping:any,budget:LookupBudget=weightLookupBudget()){
 if(!canRecalculateWeight(order))return null;
 const weights=new Map<string,UnitWeight>(),items=Array.isArray(order.items)?order.items:[],skus=[...new Set<string>(items.map((item:any)=>String(item.sku||'')).filter(Boolean))];
 const isAmazon=order.source_channel==='amazon',isShopify=order.source_channel==='shopify';
 if(!items.length&&weightInKg(order.raw_payload?.shipping_details?.measurement?.weight?.value,order.raw_payload?.shipping_details?.measurement?.weight?.unit))return null;
 if(skus.length&&(isAmazon||isShopify)){
  const table=isAmazon?'amazon_product_mappings':'shopify_product_mappings';
  let mappingQuery=admin.from(table).select('seller_sku,product_id,consumption_factor'+(isAmazon?',amazon_account_id':'')).eq('owner_id',order.owner_id).in('seller_sku',skus);
  if(isAmazon){const {data:account,error}=await admin.from('amazon_accounts').select('id').eq('owner_id',order.owner_id).eq('integration_account_id',order.source_integration_account_id).maybeSingle();if(error)throw error;if(account)mappingQuery=mappingQuery.eq('amazon_account_id',account.id);else mappingQuery=mappingQuery.eq('amazon_account_id','00000000-0000-0000-0000-000000000000');}
  else mappingQuery=mappingQuery.eq('integration_account_id',order.source_integration_account_id);
  const {data:mappings,error}=await mappingQuery;if(error)throw error;
  const ids=[...new Set((mappings||[]).map((m:any)=>m.product_id))];
  if(ids.length){const {data:products,error}=await admin.from('products').select('id,unit_weight_kg').eq('owner_id',order.owner_id).in('id',ids);if(error)throw error;
   for(const sku of skus){const matches=(mappings||[]).filter((m:any)=>m.seller_sku===sku);if(!matches.length)continue;let sum=0,complete=true;for(const mapping of matches){const kg=positive((products||[]).find((p:any)=>p.id===mapping.product_id)?.unit_weight_kg);if(!kg){complete=false;break;}sum+=kg*(positive(mapping.consumption_factor)||1);}if(complete)weights.set(sku,{kg:sum,source:'product'});}
  }
 }
 let credentials:any=null;
 for(const item of items){const sku=String(item.sku||'');if(weights.has(sku))continue;
  if(weightInKg(item.measurement?.weight?.value,item.measurement?.weight?.unit))continue;
  if(isAmazon&&item.product_id&&order.source_integration_account_id){
   const marketplaceId=order.raw_payload?.amazon?.marketplaceId||'A1RKKUPIHCS9HS';
   const key=[order.owner_id,order.source_integration_account_id,marketplaceId,item.product_id].join(':');
   const weight=await cachedCatalogWeight(key,async()=>{
    credentials=credentials||await loadAmazonSpApiCredentials(admin,{ownerId:order.owner_id,integrationAccountId:order.source_integration_account_id});
    const catalog=await spApiRequest('/catalog/2022-04-01/items/'+encodeURIComponent(item.product_id),{maxAttempts:1,query:{marketplaceIds:[marketplaceId],includedData:['attributes','dimensions']}},credentials);
    return catalogUnitWeight(catalog);
   },budget);
   if(weight){item.measurement={...(item.measurement||{}),weight:{value:weight.kg,unit:'kg'}};item.weight_source=weight.source;}
  }
 }
 const result=calculatePackageWeight(items,weights,shipping),raw=order.raw_payload||{};
 order.raw_payload={...raw,_zenvia_weight:result,shipping_details:{...(raw.shipping_details||{}),measurement:{...(raw.shipping_details?.measurement||{}),weight:{value:result.kg,unit:'kg'}}}};
 return result;
}
