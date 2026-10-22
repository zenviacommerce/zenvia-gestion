import {webhookToken} from './webhook.ts';
export async function configureSendcloudWebhook(account:any,credentials:any,supabaseUrl:string,request:typeof fetch=fetch){
 const publicKey=credentials.publicKey||credentials.public_key,secret=credentials.secretKey||credentials.secret_key;
 if(!publicKey||!secret)throw Error('SENDCLOUD_CREDENTIALS_REQUIRED');
 const endpoint=new URL('/functions/v1/shipment-tracking-webhook',supabaseUrl);endpoint.searchParams.set('account',account.id);
 const base='https://panel.sendcloud.sc/api/v3/event-subscriptions';
 async function api(path:string,method='GET',body?:any){const r=await request(base+path,{method,headers:{Authorization:'Basic '+btoa(publicKey+':'+secret),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('SENDCLOUD_WEBHOOK_HTTP_'+r.status);return r.json()}
 const existing=await api('/connections');if(!Array.isArray(existing.data))throw Error('SENDCLOUD_CONNECTION_SCHEMA_CHANGED');
 let connection=existing.data.find((c:any)=>c.type==='webhook'&&c.configuration?.url===endpoint.href);
 if(!connection){connection=(await api('/connections','POST',{type:'webhook',configuration:{url:endpoint.href,auth_type:'bearer',auth_config:{token:await webhookToken(secret,account.owner_id,account.id)}}})).data}
 if(!Number.isSafeInteger(connection?.id)||connection.id<=0)throw Error('SENDCLOUD_CONNECTION_SCHEMA_CHANGED');
 const subscriptions=await api('/subscriptions');if(!Array.isArray(subscriptions.data))throw Error('SENDCLOUD_SUBSCRIPTION_SCHEMA_CHANGED');
 let subscription=subscriptions.data.find((s:any)=>s.connection_id===connection.id&&s.event_type==='parcels.event.created');
 if(!subscription)subscription=(await api('/subscriptions','POST',{connection_id:connection.id,event_type:'parcels.event.created',is_active:true})).data;
 else if(!subscription.is_active)subscription=(await api('/subscriptions/'+subscription.id,'PATCH',{is_active:true})).data;
 if(!Number.isSafeInteger(subscription?.id)||subscription.id<=0)throw Error('SENDCLOUD_SUBSCRIPTION_SCHEMA_CHANGED');
 const test=(await api('/broadcast/test/'+subscription.id,'POST')).data;
 const verified=test?.success===true&&Number(test?.status_code)>=200&&Number(test?.status_code)<300;
 if(!verified)await api('/subscriptions/'+subscription.id,'PATCH',{is_active:false});
 return {connectionId:connection.id,subscriptionId:subscription.id,verified,statusCode:Number(test?.status_code)||null};
}
