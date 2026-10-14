import { useEffect, useState } from 'react';
import { ProductMappingModal } from '../ProductMappingModal';
import { AmazonMappingEditor } from './AmazonMappingEditor';
import { loadAmazonProductMetadata } from '../../services/amazon';

type Props={
  sellerSku:string;
  asin?:string|null;
  imageUrl?:string|null;
  productName?:string|null;
  initialFactor?:number;
  onChanged:()=>void;
  onClose:()=>void;
};

export function AmazonMappingModal({sellerSku,asin,imageUrl,productName,initialFactor=1,onChanged,onClose}:Props){
  const [resolvedName,setResolvedName]=useState(productName||null);
  const [resolvedImage,setResolvedImage]=useState(imageUrl||null);

  useEffect(()=>{
    setResolvedName(productName||null);
    setResolvedImage(imageUrl||null);
    if(!asin||(productName&&imageUrl))return;
    let active=true;
    void loadAmazonProductMetadata([asin]).then(metadata=>{
      if(!active)return;
      const product=metadata[asin];
      if(!product)return;
      if(!productName&&product.productName)setResolvedName(product.productName);
      if(!imageUrl&&product.imageUrl)setResolvedImage(product.imageUrl);
    }).catch(()=>undefined);
    return()=>{active=false};
  },[asin,productName,imageUrl]);

  return <ProductMappingModal name={resolvedName||sellerSku} subtitle={`${sellerSku} · ${asin||'ASIN no disponible'}`} imageUrl={resolvedImage} channelName="Amazon" onClose={onClose}>
    <AmazonMappingEditor sellerSku={sellerSku} productName={resolvedName} defaultFactor={initialFactor} onChanged={onChanged} onCancel={onClose}/>
  </ProductMappingModal>;
}
