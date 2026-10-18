import {useState} from 'react';
import {ShieldCheck,ScanQrCode} from 'lucide-react';
import './auth-gestion-brand.css';
import {supabase} from '../services/supabase';
import {useMfaAccess} from '../context/MfaContext';
export function MfaScreen(){
 const access=useMfaAccess();
 const [factor,setFactor]=useState('');const [qr,setQr]=useState('');const [secret,setSecret]=useState('');const [code,setCode]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const enrolling=access.state==='enrollment_required';
 const begin=async()=>{
  setBusy(true);setError('');
  try{
   const result=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:`Autenticador ${new Date().toISOString()}`});if(result.error)throw result.error;
   const prepared=await supabase.rpc('security_mfa_prepare_enrollment',{p_factor_id:result.data.id});if(prepared.error)throw prepared.error;
   if(!/^data:image\/svg\+xml;(?:utf-8|charset=utf-8),/i.test(result.data.totp.qr_code))throw new Error('MFA_QR_FORMAT');
   setFactor(result.data.id);setQr(result.data.totp.qr_code);setSecret(result.data.totp.secret);
  }catch{setError('No se pudo preparar el autenticador. Reintenta o contacta con soporte si el alta ya estaba iniciada.');}finally{setBusy(false)}
 };
 const verify=async()=>{
  if(!/^\d{6}$/.test(code)){setError('Introduce los seis dígitos del autenticador.');return;}
  const factorId=enrolling?(factor||access.enrollment_factor_id):factor||access.factor_ids[0];
  if(!factorId){setError('No hay un factor autorizado disponible. Contacta con soporte.');return;}
  setBusy(true);setError('');
  try{
   const challenge=await supabase.auth.mfa.challenge({factorId});if(challenge.error)throw challenge.error;
   const checked=await supabase.auth.mfa.verify({factorId,challengeId:challenge.data.id,code});if(checked.error)throw checked.error;
   if(enrolling){const completed=await supabase.rpc('security_mfa_complete_enrollment',{p_factor_id:factorId});if(completed.error)throw completed.error;}
   setCode('');setQr('');setSecret('');access.recheck();
  }catch{setCode('');setError('No se pudo verificar el código. Comprueba el autenticador y vuelve a intentarlo.');}finally{setBusy(false)}
 };
 const unavailable=access.state==='temporarily_unavailable';const locked=access.state==='recovery_locked';
 return <div className="authPage"><section className={enrolling?"authPanel mfaEnrollmentDialog":"authPanel"} role={enrolling?"dialog":undefined} aria-modal={enrolling?true:undefined} aria-live="polite"><div className="authHeroIcon"><ShieldCheck size={25}/></div><h1>{unavailable?'Seguridad temporalmente no disponible':locked?'Recuperación protegida':enrolling?'Configurar autenticador':access.state==='checking'?'Comprobando seguridad…':'Verifica tu autenticador'}</h1>
 {locked?<p>El acceso administrativo está bloqueado. Contacta con el canal de soporte previamente registrado para la recuperación asistida y una segunda aprobación. Cambiar la contraseña no elimina esta protección.{access.recovery_session_id&&<> Referencia de esta sesión para soporte: <code>{access.recovery_session_id}</code>.</>}</p>:unavailable?<p>No se pudo comprobar la seguridad de la sesión. Puedes reintentar sin cerrar sesión.</p>:access.state==='checking'?<p>Espera mientras comprobamos la sesión.</p>:<>
 {enrolling&&!factor&&!access.enrollment_factor_id&&<button onClick={()=>void begin()} className="primary" disabled={busy}>Configurar autenticador</button>}
 {qr&&<div className="mfaQrPanel" role="group" aria-label="Alta de autenticador"><ScanQrCode size={20}/><img alt="QR para configurar el autenticador" src={qr} style={{width:220,height:220}}/><p>Guarda el secreto solo en tu autenticador: <code>{secret}</code></p></div>}
 {(!enrolling||factor||access.enrollment_factor_id)&&<form onSubmit={event=>{event.preventDefault();void verify()}}>
 {!enrolling&&access.factor_ids.length>1&&<fieldset><legend>Autenticador</legend>{access.factor_ids.map((id,index)=><label key={id}><input type="radio" name="mfa-factor" checked={(factor||access.factor_ids[0])===id} onChange={()=>setFactor(id)}/>Dispositivo {index+1}</label>)}</fieldset>}
 <label>Código de seis dígitos<input aria-label="Código de seis dígitos" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></label><button className="primary" disabled={busy} type="submit">Verificar</button></form>}
 </>}
 {error&&<p role="alert">{error}</p>}<div className="actions">{(unavailable||locked)&&<button onClick={access.recheck}>Reintentar</button>}<button className="secondary" onClick={()=>void supabase.auth.signOut()}>Cerrar sesión</button></div></section></div>;
}
