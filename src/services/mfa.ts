import {supabase} from './supabase';
export type MfaState='checking'|'signed_out'|'ready'|'enrollment_required'|'challenge_required'|'recovery_locked'|'temporarily_unavailable';
export type MfaStatus={state:MfaState;factor_ids:string[];enrollment_factor_id?:string|null;recovery_session_id?:string|null};
export async function sensitiveRPC(name:string,args:Record<string,unknown>={}){
 const result=await supabase.rpc(name,args);
 if(result.error&&/MFA_(?:REQUIRED|RECENT_REQUIRED|FACTOR_REQUIRED|SESSION_REQUIRED|RECOVERY_LOCKED)/.test(result.error.message||'')){
  window.dispatchEvent(new CustomEvent('zenvia:mfa-required'));
  throw new Error('Debes verificar tu autenticador. Después, revisa el resultado de la operación antes de volver a confirmarla.');
 }
 return result;
}
