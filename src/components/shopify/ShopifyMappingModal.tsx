import { useMemo } from 'react';
import { ProductMappingEditor, type ProductMappingBackend } from '../ProductMappingEditor';
import { ProductMappingModal } from '../ProductMappingModal';
import { addShopifyMapping, createShopifyProduct, deleteShopifyMapping, loadShopifyMappings, loadShopifyProductOptions, type ShopifyProduct } from '../../services/shopifyAnalytics';
export function ShopifyMappingModal({product,onClose,onChanged,calendarDay}:{product:ShopifyProduct;onClose:()=>void;onChanged:()=>void;calendarDay:string}){
 const backend=useMemo<ProductMappingBackend>(()=>({
  loadMappings:sku=>loadShopifyMappings(product.storeId,sku),
  loadOptions:loadShopifyProductOptions,
  save:async input=>{await addShopifyMapping(product.storeId,input.sellerSku,input.productId,input.consumptionFactor);return {};},
  create:input=>createShopifyProduct({storeId:product.storeId,sku:input.sellerSku,name:input.name,internalSku:input.sku,baseUnit:input.unit,cost:input.unitCost==null?'':String(input.unitCost),costFrom:input.costFrom||'',factor:String(input.consumptionFactor)}),
  remove:(sku,productId)=>deleteShopifyMapping(product.storeId,sku,productId),
 }),[product.storeId]);
 return <ProductMappingModal name={product.name||product.sku} subtitle={`${product.sku} · ${product.storeName}`} imageUrl={product.imageUrl} channelName="Shopify" onClose={onClose}>
  <ProductMappingEditor sellerSku={product.sku} productName={product.name} defaultFactor={product.consumptionFactor||1} calendarDay={calendarDay} channelName="Shopify" backend={backend} onChanged={onChanged} onCancel={onClose}/>
 </ProductMappingModal>;
}
