import {supabase} from './supabase';
import {normalizeIban,normalizeBic,validateBankAccountInput} from './bankAccountValidation';

export type BusinessBankAccount={id:string;alias:string;iban:string;bic:string|null;holder:string|null;isDefault:boolean;archivedAt:string|null;validationStatus:'valid'|'needs_review'};
export type BankAccountSnapshot={version:1;accountId:string|null;alias:string;iban:string;bic:string|null;holder:string|null};
export type BankAccountSnapshotSource='issued'|'receipt_created'|'legacy_current_render'|'legacy_missing';
export type BusinessBankAccountInput={id?:string|null;alias:string;iban:string;bic?:string|null;holder?:string|null;isDefault?:boolean};
export const MISSING_BANK_ACCOUNT_MESSAGE='Falta una cuenta bancaria en Configuración → General';
const mapAccount=(row:any):BusinessBankAccount=>({id:row.id,alias:row.alias,iban:row.iban,bic:row.bic??null,holder:row.holder??null,isDefault:Boolean(row.is_default),archivedAt:row.archived_at??null,validationStatus:row.validation_status});

export async function loadBusinessBankAccounts(options?:{includeArchived?:boolean}):Promise<BusinessBankAccount[]>{
 let query=supabase.from('business_bank_accounts').select('id,alias,iban,bic,holder,is_default,archived_at,validation_status').order('is_default',{ascending:false}).order('alias');
 if(!options?.includeArchived)query=query.is('archived_at',null);
 const {data,error}=await query;if(error)throw error;return (data??[]).map(mapAccount);
}
export async function saveBusinessBankAccount(input:BusinessBankAccountInput):Promise<BusinessBankAccount>{
 validateBankAccountInput(input);
 const {data,error}=await supabase.rpc('save_business_bank_account',{p_id:input.id||null,p_alias:input.alias.trim(),p_iban:normalizeIban(input.iban),p_bic:normalizeBic(input.bic)||null,p_holder:input.holder?.trim()||null,p_is_default:Boolean(input.isDefault)});
 if(error)throw error;return mapAccount(data);
}
export async function setDefaultBusinessBankAccount(id:string):Promise<BusinessBankAccount>{
 const {data,error}=await supabase.rpc('set_default_business_bank_account',{p_account_id:id});if(error)throw error;return mapAccount(data);
}
export async function archiveBusinessBankAccount(id:string,replacementDefaultId?:string|null):Promise<void>{
 const {error}=await supabase.rpc('archive_business_bank_account',{p_account_id:id,p_replacement_default_id:replacementDefaultId||null});if(error)throw error;
}
