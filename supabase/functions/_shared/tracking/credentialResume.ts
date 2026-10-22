// Called only after the authenticated integration update has persisted its Vault
// secret. Retry credential failures only after an explicit SAGEC credential edit
// and only when the saved merged username/password pair is complete.
export async function resumeMrwTrackingAfterCredentialSave(admin:any,account:any,credentials:Record<string,unknown>|null,now=new Date().toISOString(),savedCredentials:Record<string,unknown>|null=credentials){
 if(account.provider!=='mrw'||![credentials?.username,credentials?.userName,credentials?.usuario,credentials?.password].some(value=>String(value??'').trim()))return;
 if(![savedCredentials?.username,savedCredentials?.userName,savedCredentials?.usuario].some(value=>String(value??'').trim())||!String(savedCredentials?.password??'').trim())return;
 const paused=await admin.from('shipment_tracking_account_health').select('account_id')
  .eq('account_id',account.id).eq('owner_id',account.owner_id).eq('provider','mrw')
  .in('last_error',['MRW_CREDENTIALS_REQUIRED','MRW_TRACKING_PASSWORD_REQUIRED','MRW_TRACKING_ACCESS_DENIED','MRW_CREDENTIALS_REJECTED']);
 if(paused.error)throw Error('MRW_TRACKING_RESUME_FAILED');
 if(!paused.data?.length)return;
 const awakened=await admin.from('shipment_tracking_state').update({next_poll_at:now})
  .eq('account_id',account.id).eq('owner_id',account.owner_id).eq('provider','mrw')
  .not('next_poll_at','is',null)
  .or('normalized_state.is.null,normalized_state.not.in.(delivered,returned,cancelled)')
  .in('last_error',['MRW_CREDENTIALS_REQUIRED','MRW_TRACKING_PASSWORD_REQUIRED','MRW_TRACKING_ACCESS_DENIED','MRW_CREDENTIALS_REJECTED','ACCOUNT_PAUSED']);
 if(awakened.error)throw Error('MRW_TRACKING_RESUME_FAILED');
 // Clear the health pause last, so a failed wake can be retried by saving again.
 const resumed=await admin.from('shipment_tracking_account_health')
  .update({paused_until:null,last_error:null})
  .eq('account_id',account.id).eq('owner_id',account.owner_id).eq('provider','mrw')
  .in('last_error',['MRW_CREDENTIALS_REQUIRED','MRW_TRACKING_PASSWORD_REQUIRED','MRW_TRACKING_ACCESS_DENIED','MRW_CREDENTIALS_REJECTED']);
 if(resumed.error)throw Error('MRW_TRACKING_RESUME_FAILED');
}

// Canonical SAGEC fields are the entire stored MRW credential contract.
export function normalizeMrwCredentials(value:unknown):Record<string,string>{
 const input=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const fields:Record<string,string[]>={franchiseCode:['franchiseCode','codigoFranquicia'],subscriberCode:['subscriberCode','codigoAbonado'],departmentCode:['departmentCode','codigoDepartamento'],username:['username','userName','usuario'],password:['password']};
 return Object.fromEntries(Object.entries(fields).flatMap(([key,aliases])=>{
  const text=aliases.map(alias=>typeof input[alias]==='string'?input[alias].trim():'').find(Boolean);
  return text?[[key,text]]:[];
 }));
}
export function mergeMrwCredentials(saved:unknown,edits:unknown){
 return {...normalizeMrwCredentials(saved),...normalizeMrwCredentials(edits)};
}
