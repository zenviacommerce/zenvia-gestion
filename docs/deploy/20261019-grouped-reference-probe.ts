// Production verification source; one-time header value redacted. Endpoint restored to original constant410 after verification.
import {createAdminClient} from '../_shared/amazon/supabase.ts';
import {loadAmazonSpApiCredentials} from '../_shared/amazon/config.ts';
import {spApiRequest} from '../_shared/amazon/sp-api.ts';
const markets=['A1PA6795UKMFR9','A13V1IB3VIYZZH','A1805IZSGTT6HS','A1C3SOZRARQ6R3','AMEN7PMS3EDWL','A1RKKUPIHCS9HS','A28R8C7NBKEWEA','APJ6JRA9NG5V4','A2NODRKZP88ZB9'];
Deno.serve(async(req)=>{
 if(req.method!=='POST'||req.headers.get('x-release-proof')!=="<ephemeral-guard-redacted>"||Date.now()>Date.parse('2026-10-19T17:00:00Z'))return new Response('Gone',{status:410});
 try{
 const {marketplace,before}=await req.json(); if(!markets.includes(marketplace)||!before||Date.parse(before)>Date.now()-120000)throw Error('Invalid proof scope');
 const admin=createAdminClient(),owner='7461b2b7-f383-460d-b1c7-6ccbb52e42b2',account='af6b6833-c9d7-46a4-9b62-20dd11bf529c';
 const credentials=await loadAmazonSpApiCredentials(admin,{amazonAccountId:account,ownerId:owner});
 let token,orders:any[]=[],pages=0;
 do{const data:any=await spApiRequest('/orders/2026-01-01/orders',{query:{marketplaceIds:[marketplace],createdAfter:'2026-10-17T22:00:00Z',createdBefore:before,maxResultsPerPage:100,includedData:['FULFILLMENT'],...(token?{paginationToken:token}:{})}},credentials);
 orders.push(...(data.orders||[]));token=data.pagination?.nextToken;pages++;if(pages>10)throw Error('Proof page bound exceeded');
 }while(token);
 const ids=[...new Set(orders.map(x=>String(x.orderId)))];
 const {data:rows,error}=ids.length?await admin.from('amazon_orders').select('amazon_order_id,marketplace_id').eq('owner_id',owner).eq('amazon_account_id',account).eq('marketplace_id',marketplace).in('amazon_order_id',ids):{data:[],error:null};
 if(error)throw error;const imported=new Set((rows||[]).map(x=>x.amazon_order_id));
 return Response.json({marketplace,before,pages,amazon:ids.length,yesterday:orders.filter(x=>x.createdTime<'2026-10-18T22:00:00Z').length,today:orders.filter(x=>x.createdTime>='2026-10-18T22:00:00Z').length,imported:imported.size,missing:ids.filter(x=>!imported.has(x)),invalidMarketplace:orders.filter(x=>x.salesChannel?.marketplaceId!==marketplace).length});
 }catch(e){return Response.json({error:e.message},{status:500});}
});
