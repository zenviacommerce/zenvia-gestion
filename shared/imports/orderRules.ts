export function preserveImportedShipping(existing:Record<string,any>|undefined,incoming:Record<string,any>){
 if(!existing)return incoming;const row={...incoming};
 if(existing.shipping_provider||existing.label_created_at){row.shipping_integration_account_id=existing.shipping_integration_account_id;for(const key of ['tracking_number','tracking_url','carrier_name','tracking_status_code','tracking_status_message','tracking_updated_at','fulfilled_at'])if(existing[key]!=null&&!row[key])row[key]=existing[key];}
 return row;
}
