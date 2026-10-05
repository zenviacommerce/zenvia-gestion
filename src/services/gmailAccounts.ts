import { supabase } from './supabase';
import { connectGmail, connectGmailPersistent, getCachedGmailConnection, rememberGmailConnection, type GmailConnection } from './gmail';
import { createIntegrationAccount, loadIntegrationAccounts, updateIntegrationAccount, testIntegrationAccount, type IntegrationAccount } from './integrationAccounts';

export async function gmailAccountRequest<T>(action:string,body:Record<string,unknown>={}):Promise<T>{
  const {data,error}=await supabase.functions.invoke('integration-accounts',{body:{action,...body},headers:{'X-Requested-With':'XmlHttpRequest'}});
  if(error){
    let detail='';
    try{detail=String((await error.context?.clone().json())?.error||'');}catch{}
    throw new Error(detail||error.message||'No se pudo acceder a la cuenta de Gmail.');
  }
  if(data?.error)throw new Error(data.error);
  return data as T;
}

export function selectDefaultGmailAccount(accounts:IntegrationAccount[]):IntegrationAccount|null{
  const enabled=accounts.filter(account=>account.provider==='gmail'&&account.enabled&&account.status!=='disabled'&&account.externalAccountId);
  return enabled.find(account=>account.isDefault)||enabled[0]||null;
}

export async function loadRegisteredGmailAccounts():Promise<IntegrationAccount[]>{
  const result=await gmailAccountRequest<{accounts:IntegrationAccount[]}>('gmail_list');
  return result.accounts.filter(account=>account.enabled&&account.status!=='disabled');
}

export async function connectRegisteredGmail(config:Record<string,unknown>={months:12,invoiceImportEnabled:true},expectedEmail?:string){
  const capability=await gmailAccountRequest<{persistent:boolean;clientId?:string}>('gmail_config');
  if(capability.persistent&&capability.clientId){
    const code=await connectGmailPersistent(capability.clientId,expectedEmail);
    const result=await gmailAccountRequest<{account:IntegrationAccount;connection:GmailConnection}>('gmail_exchange',{code,config,expectedEmail});
    rememberGmailConnection(result.connection);
    return result;
  }
  const connection=await connectGmail(true);
  if(expectedEmail&&connection.email.toLowerCase()!==expectedEmail.toLowerCase())throw new Error(`Selecciona ${expectedEmail} en Google para renovar esta cuenta.`);
  const accounts=await loadIntegrationAccounts();
  const existing=accounts.find(account=>account.provider==='gmail'&&!account.legacy&&account.externalAccountId?.toLowerCase()===connection.email.toLowerCase());
  const account=existing
    ?await updateIntegrationAccount(existing.id,{enabled:true,config})
    :await createIntegrationAccount({provider:'gmail',displayName:connection.email,externalAccountId:connection.email,config,test:false});
  const tested=await testIntegrationAccount(account.id);
  return {account:tested.account,connection};
}

export async function ensureRegisteredGmailConnection(account:IntegrationAccount):Promise<GmailConnection>{
  if(!account.enabled||account.status==='disabled'||!account.externalAccountId)throw new Error('La cuenta de Gmail está desactivada. Revísala en Integraciones.');
  const cached=getCachedGmailConnection(account.externalAccountId);
  if(cached)return cached;
  if(account.credentialSource==='vault'){
    const result=await gmailAccountRequest<{connection:GmailConnection}>('gmail_token',{id:account.id});
    if(result.connection.email.toLowerCase()!==account.externalAccountId.toLowerCase())throw new Error('La autorización no corresponde al buzón seleccionado.');
    rememberGmailConnection(result.connection);
    return result.connection;
  }
  const connection=await connectGmail(false);
  if(connection.email.toLowerCase()!==account.externalAccountId.toLowerCase())throw new Error(`Selecciona ${account.externalAccountId} en Google para renovar esta cuenta.`);
  return connection;
}
