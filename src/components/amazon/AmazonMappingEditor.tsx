import { ProductMappingEditor, type ProductMappingBackend } from '../ProductMappingEditor';
import { createAmazonProductAndMapping, deleteAmazonProductMappingItem, loadAmazonProductMappings, loadAmazonProductOptions, setAmazonProductMapping } from '../../services/amazon';
const backend:ProductMappingBackend={loadMappings:loadAmazonProductMappings,loadOptions:loadAmazonProductOptions,save:setAmazonProductMapping,create:createAmazonProductAndMapping,remove:deleteAmazonProductMappingItem};
export function AmazonMappingEditor(props:{sellerSku:string;productName?:string|null;defaultFactor?:number;onChanged:()=>void;onCancel?:()=>void}){
 return <ProductMappingEditor {...props} channelName="Amazon" backend={backend}/>;
}
