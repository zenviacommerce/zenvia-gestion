import {getActiveSupabase,getActiveTenant} from './supabase';
import {createAmazonReadQueue} from './amazonReadQueue';
import {shopifyCreateParams,type ShopifyCreateDraft,type ShopifyFilters,type ShopifySummary} from './shopifyAnalyticsCore';
export type {ShopifyFilters,ShopifySummary} from './shopifyAnalyticsCore';
export type ShopifyStore={id:string;name:string;domain:string;status:string;lastSyncedAt:string|null;availableFrom:string|null;inventoryAvailable:boolean;catalogAvailable?:boolean;historyLimited?:boolean;error:string|null};
export type ShopifyStatus={connected:boolean;stores:ShopifyStore[]};
export type ShopifyProduct={id:string;storeId:string;storeName:string;sku:string;variantId?:string|null;name:string;imageUrl:string|null;mappingProductId:string|null;mappingProductName:string|null;consumptionFactor:number;orders:number;units:number;grossSales:number|null;netSales:number|null;refunds:number|null;productCost:number|null;shippingCost?:number|null;profitBeforeAds:number|null;currency:'EUR';profitComplete:boolean;inventoryQuantity:number|null};
export type ShopifyMapping={id?:string;productId:string;productName:string;productSku:string|null;supplierName:string|null;unitCost:number|null;costUnit:string|null;consumptionFactor:number};
export type ShopifyProductSort='product_name'|'units'|'orders'|'gross_sales'|'net_sales'|'refunds'|'product_cost'|'shipping_cost'|'profit_before_ads'|'inventory_quantity'|'mapping_product_name';
export type ShopifyProductOption={id:string;name:string;sku:string|null;unitCost:number|null;costUnit:string|null};
const reads=createAmazonReadQueue(2,60_000);
export function invalidateShopifyAnalytics(){reads.clear();}
async function context(){const client=getActiveSupabase(),workspace=getActiveTenant()?.workspace_id;const {data:{session},error}=await client.auth.getSession();if(error)throw error;if(!session)throw new Error('Inicia sesión para consultar Shopify.');return {client,workspace,user:session.user.id};}
async function rpc<T>(name:string,params:Record<string,unknown>,cache=true):Promise<T>{
 const scope=await context();
 const load=async()=>{
  const current=await scope.client.auth.getSession();
  if(getActiveSupabase()!==scope.client||getActiveTenant()?.workspace_id!==scope.workspace||current.data.session?.user.id!==scope.user)throw new Error('La sesión o empresa ha cambiado.');
  const {data,error}=await scope.client.rpc(name,params);if(error)throw error;
  const after=await scope.client.auth.getSession();
  if(getActiveSupabase()!==scope.client||getActiveTenant()?.workspace_id!==scope.workspace||after.data.session?.user.id!==scope.user)throw new Error('La sesión o empresa ha cambiado.');
  return data as T;
 };
 return cache?reads.read(JSON.stringify([scope.workspace,scope.user,name,params]),load):load();
}
const range=(filters:ShopifyFilters)=>({from_date:filters.from,to_date:filters.to,integration_account_ids:filters.storeIds.length?filters.storeIds:null});
export const loadShopifyStatus=()=>rpc<ShopifyStatus>('shopify_analytics_status',{});
export const loadShopifySummary=(filters:ShopifyFilters)=>rpc<ShopifySummary>('shopify_analytics_summary',range(filters));
export const loadShopifyProducts=(filters:ShopifyFilters,search='',page=1,pageSize=50,sortBy:ShopifyProductSort='product_name',sortDir:'asc'|'desc'='asc',includeCatalog=false)=>rpc<{items:ShopifyProduct[];total:number;page:number;pageSize:number}>('shopify_analytics_products',{...range(filters),search,page,page_size:pageSize,sort_by:sortBy,sort_dir:sortDir,include_catalog:includeCatalog});
export const loadShopifyMappings=(storeId:string,sku:string)=>rpc<ShopifyMapping[]>('shopify_get_product_mappings',{integration_account_id:storeId,seller_sku:sku},false);
async function mutate<T>(name:string,params:Record<string,unknown>){invalidateShopifyAnalytics();try{return await rpc<T>(name,params,false);}finally{invalidateShopifyAnalytics();}}
export function addShopifyMapping(storeId:string,sku:string,productId:string,factor:number){if(!Number.isFinite(factor)||factor<=0)throw new Error('El factor debe ser mayor que cero.');return mutate('shopify_add_product_mapping',{integration_account_id:storeId,seller_sku:sku,product_id:productId,consumption_factor:factor});}
export const deleteShopifyMapping=(storeId:string,sku:string,productId:string)=>mutate('shopify_delete_product_mapping_item',{integration_account_id:storeId,seller_sku:sku,product_id:productId});
export const createShopifyProduct=(draft:ShopifyCreateDraft)=>mutate<{ok:boolean;productId:string;created?:boolean}>('shopify_create_product_and_mapping',shopifyCreateParams(draft));
export const loadShopifyProductOptions=(search='')=>rpc<ShopifyProductOption[]>('shopify_product_options',{search:search.trim()||null},false);
export async function syncShopifyAnalytics(integrationAccountId?:string,history=false){const scope=await context();const {data,error}=await scope.client.functions.invoke('shopify-analytics-sync',{body:{integrationAccountId,history}});if(error)throw error;if(!data?.ok)throw new Error(data?.error||'No se pudo sincronizar Shopify.');const after=await scope.client.auth.getSession();if(getActiveSupabase()!==scope.client||getActiveTenant()?.workspace_id!==scope.workspace||after.data.session?.user.id!==scope.user)throw new Error('La sesión o empresa ha cambiado.');invalidateShopifyAnalytics();return data as {ok:boolean;synced:number;stores:number;errors?:unknown[]};}
