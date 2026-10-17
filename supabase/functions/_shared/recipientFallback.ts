const clean=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
export const recipientProviders=['sendcloud','envia'] as const;
export function recipientSource(amazon:any,accounts:any[]){
 const id=clean(amazon?.config?.recipientSourceAccountId);
 return accounts.find(a=>id&&a.id===id&&a.owner_id===amazon.owner_id&&a.enabled===true&&a.status!=='disabled'&&!a.config?.archivedAt&&recipientProviders.includes(a.provider))||null;
}
export function recipientCandidate(provider:string,row:any){
 const refs=provider==='envia'?[row?.order?.identifier,row?.order?.order_identifier,row?.order?.name,row?.order_identifier,row?.order_number]:[row?.order_id,row?.order_number,row?.order_details?.order_id];
 const reference=refs.map(clean).find(value=>/^\d{3}-\d{7}-\d{7}$/.test(value));
 if(!reference)return null;
 const d=provider==='envia'?(row?.shipment_data?.destination||row?.shipment_data?.destination_address||row?.destination||{}):(row?.shipping_address||{});
 const customer=provider==='envia'?(row?.customer||{}):(row?.customer_details||{});
 const address={name:clean(d.name||customer.name),company_name:clean(d.company_name||d.company),address_line_1:clean(d.address_line_1||d.street||d.address||d.address1),house_number:clean(d.house_number||d.number),address_line_2:clean(d.address_line_2||d.address2),postal_code:clean(d.postal_code||d.postalCode||d.zipCode),city:clean(d.city),state_province_code:clean(d.state_province_code||d.state),country_code:clean(d.country_code||d.countryCode||d.country).toUpperCase(),email:clean(d.email||customer.email),phone_number:clean(d.phone_number||d.phone||customer.phone)};
 if(!address.name||!address.address_line_1||!address.postal_code||!address.city||!/^[A-Z]{2}$/.test(address.country_code))return null;
 return {reference,remoteId:clean(row.id),address};
}
export function recipientPatch(current:any,external:any,accountId:string,provider:string){
 if(current?.pii_purged_at)return null;
 if(current.raw_payload?._zenvia_local_shipping_updated_at)return null;
 const saved=current.shipping_address||{};
 for(const field of ['postal_code','country_code'])if(clean(saved[field])&&clean(external[field])&&clean(saved[field]).toUpperCase()!==clean(external[field]).toUpperCase())return null;
 const address={...saved};let changed=false;
 for(const [key,value] of Object.entries(external))if(!clean(address[key])&&clean(value)){address[key]=value;changed=true;}
 const patch:any={};
 for(const [column,key] of [['customer_name','name'],['customer_email','email'],['customer_phone','phone_number']])if(!clean(current[column])&&clean(address[key])){patch[column]=address[key];changed=true;}
 if(!changed)return null;
 return {...patch,shipping_address:address,raw_payload:{...current.raw_payload,_zenvia_recipient_fallback:{accountId,provider,enrichedAt:new Date().toISOString()}}};
}
