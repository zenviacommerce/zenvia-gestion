// Called only after the authenticated integration update has persisted its Vault
// secret. Only explicit tracking override edits may retry access denials;
// SAGEC-only edits and rejected/limited accounts keep their safety pause.
export async function resumeMrwTrackingAfterCredentialSave(admin:any,account:any,credentials:Record<string,unknown>|null,now=new Date().toISOString()){
 if(account.provider!=='mrw'||!String(credentials?.trackingPassword||credentials?.tracking_password||'').trim())return;
 const paused=await admin.from('shipment_tracking_account_health').select('account_id')
  .eq('account_id',account.id).eq('owner_id',account.owner_id).eq('provider','mrw')
  .in('last_error',['MRW_TRACKING_PASSWORD_REQUIRED','MRW_TRACKING_ACCESS_DENIED']);
 if(paused.error)throw Error('MRW_TRACKING_RESUME_FAILED');
 if(!paused.data?.length)return;
 const awakened=await admin.from('shipment_tracking_state').update({next_poll_at:now})
  .eq('account_id',account.id).eq('owner_id',account.owner_id).eq('provider','mrw')
  .not('next_poll_at','is',null)
  .or('normalized_state.is.null,normalized_state.not.in.(delivered,returned,cancelled)')
  .in('last_error',['MRW_TRACKING_PASSWORD_REQUIRED','MRW_TRACKING_ACCESS_DENIED','ACCOUNT_PAUSED']);
 if(awakened.error)throw Error('MRW_TRACKING_RESUME_FAILED');
 // Clear the health pause last, so a failed wake can be retried by saving again.
 const resumed=await admin.from('shipment_tracking_account_health')
  .update({paused_until:null,last_error:null})
  .eq('account_id',account.id).eq('owner_id',account.owner_id).eq('provider','mrw')
  .in('last_error',['MRW_TRACKING_PASSWORD_REQUIRED','MRW_TRACKING_ACCESS_DENIED']);
 if(resumed.error)throw Error('MRW_TRACKING_RESUME_FAILED');
}

// Tracking has its own authentication. Editing it must not invalidate the
// independently tested SAGEC connection used to create labels.
export function credentialSaveConnectionPatch(provider:string,credentials:Record<string,unknown>){
 const keys=Object.entries(credentials).filter(([,value])=>String(value??'').trim()).map(([key])=>key);
 if(provider==='mrw'&&keys.every(key=>['trackingPassword','tracking_password'].includes(key)))return {};
 return {status:'pending',last_error:null};
}
