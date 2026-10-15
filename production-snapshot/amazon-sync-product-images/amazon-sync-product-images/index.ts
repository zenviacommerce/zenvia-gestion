import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { spApiRequest } from '../_shared/amazon/sp-api.ts';
import { loadAmazonSpApiCredentials } from '../_shared/amazon/config.ts';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function fromListing(data:any){
  for(const summary of data?.summaries||[]){
    const image=summary?.mainImage;
    if(typeof image?.link==='string'&&/^https?:\/\//i.test(image.link))return {url:image.link,width:image.width||null,height:image.height||null};
  }
  const attrs=data?.attributes||{};
  const preferred=['main_product_image_locator','main_image','image_url'];
  const keys=[...preferred,...Object.keys(attrs).filter(k=>/image/i.test(k)&&!preferred.includes(k))];
  for(const key of keys){
    const values=Array.isArray(attrs?.[key])?attrs[key]:attrs?.[key]?[attrs[key]]:[];
    for(const value of values){
      const url=value?.media_location||value?.url||value?.link||value?.value;
      if(typeof url==='string'&&/^https?:\/\//i.test(url))return {url,width:null,height:null};
    }
  }
  return null;
}

function fromCatalog(data:any){
  const images=(data?.images||[]).flatMap((group:any)=>group?.images||[])
    .filter((image:any)=>image?.variant==='MAIN'&&typeof image?.link==='string'&&/^https?:\/\//i.test(image.link))
    .sort((a:any,b:any)=>(Number(b.width)||0)*(Number(b.height)||0)-(Number(a.width)||0)*(Number(a.height)||0));
  const image=images[0];
  return image?{url:image.link,width:image.width||null,height:image.height||null}:null;
}

function fromListingName(data:any){
  const summary=Array.isArray(data?.summaries)?data.summaries.find((item:any)=>String(item?.itemName||'').trim()):null;
  if(summary?.itemName)return String(summary.itemName).trim();
  const attrs=data?.attributes||{};
  for(const key of ['item_name','title','product_name']){
    const values=Array.isArray(attrs?.[key])?attrs[key]:attrs?.[key]?[attrs[key]]:[];
    for(const value of values){
      const text=String(value?.value||value?.name||value||'').trim();
      if(text)return text;
    }
  }
  return null;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const admin=createAdminClient();
    const body=await req.json().catch(()=>({}));
    const limit=Math.min(30,Math.max(1,Number(body?.limit)||10));
    const ownerId=String(body?.ownerId||'').trim();
    const amazonAccountId=String(body?.amazonAccountId||'').trim();
    const integrationAccountId=String(body?.integrationAccountId||'').trim();
    let accountQuery=admin.from('amazon_accounts').select('id,owner_id,integration_account_id').neq('status','disabled').order('updated_at',{ascending:false}).limit(1);
    if(ownerId)accountQuery=accountQuery.eq('owner_id',ownerId);
    if(amazonAccountId)accountQuery=accountQuery.eq('id',amazonAccountId);
    if(integrationAccountId)accountQuery=accountQuery.eq('integration_account_id',integrationAccountId);
    const {data:account,error:accountError}=await accountQuery.maybeSingle();
    if(accountError)throw accountError;if(!account)throw new Error('No hay cuenta Amazon configurada.');
    const credentials=await loadAmazonSpApiCredentials(admin,{amazonAccountId:account.id,integrationAccountId:account.integration_account_id,ownerId:account.owner_id});

    const {data:markets,error:marketError}=await admin.from('amazon_marketplaces').select('marketplace_id,country_code').eq('amazon_account_id',account.id).eq('owner_id',account.owner_id).eq('active',true).order('country_code');
    if(marketError)throw marketError;
    const activeMarketplaceIds=(markets||[]).map((m:any)=>String(m.marketplace_id||'')).filter(Boolean);
    const esMarketplaceId=String((markets||[]).find((m:any)=>m.country_code==='ES')?.marketplace_id||'');
    const {data:cached,error:cacheError}=await admin.from('amazon_product_images').select('asin,marketplace_id,image_url,product_name,fetched_at').eq('owner_id',account.owner_id).eq('amazon_account_id',account.id);
    if(cacheError)throw cacheError;
    const cachedAsins=new Set((cached||[]).filter((row:any)=>row.image_url&&row.product_name).map((row:any)=>String(row.asin||'')));

    const recentlyAttemptedAsins=new Set((cached||[]).filter((row:any)=>Date.parse(row.fetched_at)>Date.now()-15*60_000).map((row:any)=>String(row.asin||'')));

    let products=Array.isArray(body?.products)?body.products.map((p:any)=>({
      asin:String(p?.asin||'').trim(),sellerSku:String(p?.sellerSku||'').trim(),marketplaceId:String(p?.marketplaceId||'').trim()
    })).filter((p:any)=>p.asin&&p.sellerSku&&p.marketplaceId):[];

    if(!products.length){
      const seen=new Set<string>();
      products=[];
      for(let offset=0;offset<20000&&products.length<limit;offset+=1000){
        const {data:items,error:itemError}=await admin.from('amazon_order_items')
          .select('asin,seller_sku,marketplace_id')
          .eq('owner_id',account.owner_id).eq('amazon_account_id',account.id)
          .not('asin','is',null).not('seller_sku','is',null)
          .order('created_at',{ascending:false}).order('id',{ascending:false})
          .range(offset,offset+999);
        if(itemError)throw itemError;
        if(!(items||[]).length)break;
        for(const item of items||[]){
          const asin=String(item.asin||''),sellerSku=String(item.seller_sku||''),marketplaceId=String(item.marketplace_id||'');
          if(!asin||!sellerSku||!marketplaceId||cachedAsins.has(asin)||recentlyAttemptedAsins.has(asin)||seen.has(asin))continue;
          seen.add(asin);products.push({asin,sellerSku,marketplaceId});
          if(products.length>=limit)break;
        }
        if((items||[]).length<1000)break;
      }
    }
    products=products.slice(0,limit);

    const now=new Date().toISOString();const rows:any[]=[];const failed:any[]=[];
    for(const product of products){
      const marketplaceCandidates=Array.from(new Set([esMarketplaceId,product.marketplaceId,...activeMarketplaceIds].filter(Boolean)));
      const previous=(cached||[]).filter((row:any)=>row.asin===product.asin)
        .sort((a:any,b:any)=>Number(b.marketplace_id===esMarketplaceId)-Number(a.marketplace_id===esMarketplaceId));
      let image:any=null;let productName:string|null=null;let usedMarketplace='';let lastError='';
      for(const marketplaceId of marketplaceCandidates){
        try{
          const data:any=await spApiRequest(`/listings/2021-08-01/items/${encodeURIComponent(credentials.sellerId)}/${encodeURIComponent(product.sellerSku)}`,{
            query:{marketplaceIds:[marketplaceId],includedData:['attributes','summaries']}
          },credentials);
          image=image||fromListing(data);productName=productName||fromListingName(data);usedMarketplace=marketplaceId;

        }catch(error){lastError=error instanceof Error?error.message:'Error';}
        if(!image||!productName){
          try{
            const catalog:any=await spApiRequest(`/catalog/2022-04-01/items/${encodeURIComponent(product.asin)}`,{
              query:{marketplaceIds:[marketplaceId],includedData:['images','summaries']}
            },credentials);
            image=image||fromCatalog(catalog);productName=productName||fromListingName(catalog);
            if(image||productName)usedMarketplace=usedMarketplace||marketplaceId;
          }catch(error){lastError=error instanceof Error?error.message:'Error';}
        }
        if(image&&productName)break;
      }
      image=image||(previous.find((row:any)=>row.image_url)?{url:previous.find((row:any)=>row.image_url).image_url}:null);
      productName=productName||previous.find((row:any)=>row.product_name)?.product_name||null;
      {
        rows.push({
          owner_id:account.owner_id,amazon_account_id:account.id,asin:product.asin,seller_sku:product.sellerSku,
          marketplace_id:usedMarketplace||product.marketplaceId,product_name:productName,
          image_url:image?.url||null,image_width:image?.width||null,image_height:image?.height||null,fetched_at:now,updated_at:now
        });
      }
      if(!image||!productName){
        failed.push({asin:product.asin,sellerSku:product.sellerSku,error:lastError||(!image?'Listing sin imagen principal':'Listing sin nombre')});
      }
    }
    if(rows.length){const {error}=await admin.from('amazon_product_images').upsert(rows,{onConflict:'owner_id,amazon_account_id,asin,marketplace_id'});if(error)throw error;}
    return response({ok:true,processed:rows.length,withImage:rows.filter(r=>r.image_url).length,withName:rows.filter(r=>r.product_name).length,failed:failed.length,failures:failed.slice(0,10)});
  }catch(error){return response({error:error instanceof Error?error.message:'No se pudieron sincronizar las imágenes Amazon.'},500);}
});