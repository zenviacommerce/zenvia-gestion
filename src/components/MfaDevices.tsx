import {useEffect,useState} from 'react';
import {ShieldCheck,Plus,RefreshCw,Smartphone} from 'lucide-react';
import {useMfaAccess} from '../context/MfaContext';
import {supabase,getActiveTenant} from '../services/supabase';
import {ensureViewCacheScope} from '../services/viewCache';
/** Factor admission is a server action. Direct Auth enrollment never admits a device. */
export function MfaDevices(){
 const access=useMfaAccess();const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [removing,setRemoving]=useState<string|null>(null);
 const [renaming,setRenaming]=useState<string|null>(null);const [newName,setNewName]=useState('');
 const [details,setDetails]=useState<Record<string,{name:string;created?:string;last?:string}>>({});
 useEffect(()=>{if(!access.ready)return;let live=true;void supabase.auth.mfa.listFactors().then(({data,error})=>{if(!live||error)return;const result:Record<string,{name:string;created?:string;last?:string}>={};for(const item of data?.totp||[]){if(access.factor_ids.includes(item.id)){result[item.id]={name:item.friendly_name&&!/^Autenticador\s+\d{4}-\d\d-\d\dT/.test(item.friendly_name)?item.friendly_name:`Autenticador ${access.factor_ids.indexOf(item.id)+1}`,created:item.created_at};}}setDetails(result);}).catch(()=>{});return()=>{live=false};},[access.ready,access.factor_ids.join(',')]);
 if(!access.ready)return null;
 const add=async()=>{
  setBusy(true);setError('');
  try{
   const {error}=await supabase.rpc(access.factor_ids.length ? 'security_mfa_begin_factor_add' : 'security_mfa_begin_self_enrollment');
   if(error){if(/MFA_SESSION_REQUIRED/.test(error.message)){setError('La sesión actual se creó antes de registrar el primer factor. Cierra sesión, vuelve a iniciar sesión y valida el TOTP antes de añadir el segundo.');return;}if(/MFA_(REQUIRED|RECENT_REQUIRED)/.test(error.message)){access.requireRecent();return;}throw error;}
   access.recheck();
  }catch{setError('No se pudo autorizar el nuevo dispositivo. Reintenta después de verificar el autenticador.');}finally{setBusy(false)}
 };
 const rename=async()=>{if(!renaming||newName.trim().length<2)return;setBusy(true);setError('');try{const result=await supabase.rpc('security_mfa_rename_factor',{p_factor_id:renaming,p_friendly_name:newName.trim()});if(result.error)throw result.error;setDetails(previous=>({...previous,[renaming]:{...previous[renaming],name:newName.trim()}}));setRenaming(null);}catch{setError('No se pudo cambiar el nombre. Requiere una verificación reciente y la actualización del backend.');}finally{setBusy(false)}};
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
 return <section className="settingsSectionCard mfaSettings"><div className="settingsSectionHero"><div className="settingsSectionIcon"><ShieldCheck size={22}/></div><div><h2>Autenticadores de seguridad</h2><p>Dispositivos admitidos: {access.factor_ids.length}. {access.factor_ids.length>=2?`Protegida con ${access.factor_ids.length} dispositivos.`:access.factor_ids.length===1?'Añade y prueba un segundo dispositivo antes de depender de la recuperación asistida.':'Puedes configurar tu primer autenticador voluntariamente antes de que MFA sea obligatorio.'}</p></div><div className="mfaHeaderActions"><button type="button" className="primary" disabled={busy} onClick={()=>void add()}><Plus size={16}/>{access.factor_ids.length?'Añadir otro autenticador':'Añadir autenticador'}</button><button type="button" className="secondary" disabled={busy} onClick={access.requireRecent}><RefreshCw size={16}/>Verificar de nuevo</button></div></div><div className="mfaSettingsBody">
 {access.factor_ids.length>0&&<div className="mfaDeviceList">{access.factor_ids.map((id,index)=><div className="mfaDeviceRow" key={id}><Smartphone size={20}/><div className="mfaDeviceInfo"><strong>{details[id]?.name||`Autenticador ${index+1}`}</strong><small>Alta: {details[id]?.created?new Date(details[id].created).toLocaleString('es-ES'):'No disponible'}{details[id]?.last?' · Última verificación: '+new Date(details[id].last).toLocaleString('es-ES'):''}</small></div><button className="secondary" disabled={busy} onClick={()=>{setRenaming(id);setNewName(details[id]?.name||'')}}>Renombrar</button>{access.factor_ids.length>1&&<button className="settingsDangerButton" disabled={busy} onClick={()=>setRemoving(id)}>Quitar</button>}</div>)}</div>}
 {renaming&&<div className="mfaModalBackdrop"><div className="mfaModal" role="dialog" aria-modal="true" aria-label="Renombrar autenticador"><h3>Nombre del autenticador</h3><label className="settingsField settingsFieldWide"><span>Nombre del dispositivo</span><input aria-label="Nuevo nombre" maxLength={60} value={newName} onChange={e=>setNewName(e.target.value)}/></label><div className="mfaDialogActions"><button type="button" className="secondary" onClick={()=>setRenaming(null)}>Cancelar</button><button type="button" className="primary" disabled={busy||newName.trim().length<2} onClick={()=>void rename()}>Guardar</button></div></div></div>}
 {removing&&<div className="mfaModalBackdrop"><div className="mfaModal" role="dialog" aria-modal="true" aria-label="Confirmar retirada del autenticador"><p>Dejarás de poder usar este dispositivo. Confirma que puedes acceder al otro autenticador.</p><button type="button" className="primary" disabled={busy} onClick={()=>void remove()}>Confirmar retirada</button><button type="button" className="secondary" disabled={busy} onClick={()=>setRemoving(null)}>Cancelar</button></div></div>}
 {error&&<div className="mfaError" role="alert">{error}{error.includes('Cierra sesión')&&<button className="secondary" onClick={()=>void supabase.auth.signOut()}>Cerrar sesión y volver a entrar</button>}</div>}</div></section>;
}
