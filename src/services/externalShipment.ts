import {supabase} from './supabase';
export type ExternalShipmentInput={carrier:string;trackingNumber:string;accountId?:string;shippedAt?:string;service?:string;url?:string;cost?:number;notifySource:boolean};
export async function registerExternalShipment(orderId:string,input:ExternalShipmentInput,requestId:string){
 const {data,error}=await supabase.functions.invoke('register-external-shipment',{body:{orderId,requestId,input}});
 if(error){let detail='';try{detail=(await error.context?.clone().json())?.error||''}catch{}throw Error(detail||error.message||'No se pudo registrar el envío.')}
 if(!data?.ok)throw Error(data?.error||'No se pudo registrar el envío.');
 return data as {ok:true;orderId:string;alreadyRegistered:boolean};
}
