import {useState} from 'react';
import {useMfaAccess} from '../context/MfaContext';
import {supabase,getActiveTenant} from '../services/supabase';
import {ensureViewCacheScope} from '../services/viewCache';
/** Factor admission is a server action. Direct Auth enrollment never admits a device. */
export function MfaDevices(){
 const access=useMfaAccess();const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [removing,setRemoving]=useState<string|null>(null);
 if(!access.factor_ids.length)return null;
 const add=async()=>{
  setBusy(true);setError('');
  try{
   const {error}=await supabase.rpc('security_mfa_begin_factor_add');
   if(error){if(/MFA_(REQUIRED|RECENT_REQUIRED)/.test(error.message)){access.requireRecent();return;}throw error;}
   access.recheck();
  }catch{setError('No se pudo autorizar el nuevo dispositivo. Reintenta después de verificar el autenticador.');}finally{setBusy(false)}
 };
 const remove=async()=>{
  if(!removing)return;setBusy(true);setError('');
  let retired=false;
  try{
   const approved=await supabase.rpc('security_mfa_forget_factor',{p_factor_id:removing});
   if(approved.error){if(/MFA_(REQUIRED|RECENT_REQUIRED)/.test(approved.error.message)){access.requireRecent();return;}throw approved.error;}
   retired=true;
   const result=await supabase.auth.mfa.unenroll({factorId:removing});if(result.error)throw result.error;
  }catch{setError(retired?'El dispositivo ya no está admitido. No se pudo confirmar su retirada de Auth; comprueba el resultado antes de repetir y contacta con soporte si sigue apareciendo.':'No se pudo retirar el dispositivo. Comprueba que queda otro autenticador verificado.');}
  finally{
   if(retired){
    // Refresh cannot restore removed admission; server status remains authoritative.
    try{await supabase.auth.refreshSession();}catch{/* Recheck stays conservative on network failure. */}
    ensureViewCacheScope(getActiveTenant()?.workspace_id,null);access.recheck();
   }
   setRemoving(null);setBusy(false);
  }
 };
 return <section className="settingsSectionCard"><h2>Autenticadores de seguridad</h2><p>Dispositivos admitidos: {access.factor_ids.length}. Añade y prueba un segundo dispositivo antes de depender de la recuperación asistida.</p><button disabled={busy} onClick={()=>void add()}>Añadir otro autenticador</button><button disabled={busy} onClick={access.requireRecent}>Verificar de nuevo</button>
 {access.factor_ids.length>1&&access.factor_ids.map((id,index)=><button key={id} disabled={busy} onClick={()=>setRemoving(id)}>Quitar dispositivo {index+1}</button>)}
 {removing&&<div role="group" aria-label="Confirmar retirada del autenticador"><p>Dejarás de poder usar este dispositivo. Confirma que puedes acceder al otro autenticador.</p><button disabled={busy} onClick={()=>void remove()}>Confirmar retirada</button><button disabled={busy} onClick={()=>setRemoving(null)}>Cancelar</button></div>}
 {error&&<p role="alert">{error}</p>}</section>;
}
