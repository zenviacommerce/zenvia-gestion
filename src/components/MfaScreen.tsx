import {useEffect,useRef,useState} from 'react';
import {ShieldCheck,ScanQrCode,AlertCircle} from 'lucide-react';
import './auth-gestion-brand.css';
import {supabase} from '../services/supabase';
import {SelectField} from './forms/SelectField';
import {useMfaAccess} from '../context/MfaContext';
export function MfaScreen(){
 const access=useMfaAccess();
 const [factor,setFactor]=useState('');const [qr,setQr]=useState('');const [secret,setSecret]=useState('');const [code,setCode]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const enrolling=access.state==='enrollment_required';
 const [friendlyName,setFriendlyName]=useState('');const [names,setNames]=useState<Record<string,string>>({});
 const codeRef=useRef<HTMLInputElement|null>(null);const sending=useRef(false);
 useEffect(()=>{if(enrolling||access.state!=='challenge_required')return;let active=true;void supabase.auth.mfa.listFactors().then(({data})=>{if(!active)return;const n:Record<string,string>={};for(const [index,f] of (data?.totp||[]).entries())n[f.id]=f.friendly_name&&!/^Autenticador\s+\d{4}-\d\d-\d\dT/.test(f.friendly_name)?f.friendly_name:`Autenticador ${index+1}`;setNames(n);});return()=>{active=false};},[enrolling,access.state,access.factor_ids.join(',')]);
 useEffect(()=>{if(!enrolling&&access.state==='challenge_required')codeRef.current?.focus();},[enrolling,access.state]);
 const begin=async()=>{
  if(friendlyName.trim().length<2){setError('Escribe un nombre de dispositivo reconocible.');return;}
  setBusy(true);setError('');
  try{
   const result=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:friendlyName.trim()});if(result.error)throw result.error;
   const prepared=await supabase.rpc('security_mfa_prepare_enrollment',{p_factor_id:result.data.id});if(prepared.error)throw prepared.error;
   if(!/^data:image\/svg\+xml;(?:utf-8|charset=utf-8),/i.test(result.data.totp.qr_code))throw new Error('MFA_QR_FORMAT');
   setFactor(result.data.id);setQr(result.data.totp.qr_code);setSecret(result.data.totp.secret);
  }catch{setError('No se pudo preparar el autenticador. Reintenta o contacta con soporte si el alta ya estaba iniciada.');}finally{setBusy(false)}
 };
 const verify=async(value=code)=>{
  if(sending.current)return;
  if(!/^\d{6}$/.test(value)){setError('Introduce los seis dígitos del autenticador.');return;}
  const factorId=enrolling?(factor||access.enrollment_factor_id):factor||access.factor_ids[0];
  if(!factorId){setError('No hay un factor autorizado disponible. Contacta con soporte.');return;}
  sending.current=true;setBusy(true);setError('');
  try{
   const challenge=await supabase.auth.mfa.challenge({factorId});if(challenge.error)throw challenge.error;
   const checked=await supabase.auth.mfa.verify({factorId,challengeId:challenge.data.id,code:value});if(checked.error)throw checked.error;
   if(enrolling){const completed=await supabase.rpc('security_mfa_complete_enrollment',{p_factor_id:factorId});if(completed.error)throw completed.error;}
   setCode('');setQr('');setSecret('');access.recheck();
  }catch(e){setCode('');const message=e instanceof Error?e.message:String(e);setError(/429|rate.limit|too.many/i.test(message)?'Demasiados intentos. Espera antes de solicitar otro código.':/422|invalid|verification.failed/i.test(message)?'Código incorrecto o caducado. Comprueba la hora del autenticador y vuelve a intentarlo.':'No se pudo verificar el código. Comprueba el autenticador y vuelve a intentarlo.');setTimeout(()=>codeRef.current?.focus(),0);}finally{sending.current=false;setBusy(false)}
 };
 const unavailable=access.state==='temporarily_unavailable';const locked=access.state==='recovery_locked';
 return <div className="authPage"><section className={enrolling?"authPanel mfaEnrollmentDialog":"authPanel"} role={enrolling?"dialog":undefined} aria-modal={enrolling?true:undefined} aria-live="polite"><div className="authLogo authGestionLogo" aria-label="Zenvia Gestión"><img src="/zenvia-brand-symbol-20261012.svg" alt="" width="42" height="42"/><div><strong>ZENVIA</strong><span>GESTIÓN</span></div></div><div className="authHeroIcon"><ShieldCheck size={25}/></div><h1>{unavailable?'Seguridad temporalmente no disponible':locked?'Recuperación protegida':enrolling?'Configurar autenticador':access.state==='checking'?'Comprobando seguridad…':'Verifica tu autenticador'}</h1>
 {locked?<p>El acceso administrativo está bloqueado. Contacta con el canal de soporte previamente registrado para la recuperación asistida y una segunda aprobación. Cambiar la contraseña no elimina esta protección.{access.recovery_session_id&&<> Referencia de esta sesión para soporte: <code>{access.recovery_session_id}</code>.</>}</p>:unavailable?<p>No se pudo comprobar la seguridad de la sesión. Puedes reintentar sin cerrar sesión.</p>:access.state==='checking'?<p>Espera mientras comprobamos la sesión.</p>:<>
 {enrolling&&!factor&&!access.enrollment_factor_id&&<label>Nombre del dispositivo<input aria-label="Nombre del dispositivo" maxLength={60} value={friendlyName} required minLength={2} placeholder="Ej. iPhone personal" onChange={e=>setFriendlyName(e.target.value)}/></label>}
 {enrolling&&!factor&&!access.enrollment_factor_id&&<button onClick={()=>void begin()} className="primary" disabled={busy}>Configurar autenticador</button>}
 {qr&&<div className="mfaQrPanel" role="group" aria-label="Alta de autenticador"><ScanQrCode size={20}/><img alt="QR para configurar el autenticador" src={qr} style={{width:220,height:220}}/><p>Guarda el secreto solo en tu autenticador: <code>{secret}</code></p></div>}
 {(!enrolling||factor||access.enrollment_factor_id)&&<form onSubmit={event=>{event.preventDefault();void verify()}}>
 {!enrolling&&access.factor_ids.length>1&&<label className="mfaFactorSelect">Autenticador<SelectField ariaLabel="Autenticador" value={factor||access.factor_ids[0]} options={access.factor_ids.map((id,index)=>({value:id,label:names[id]||`Autenticador ${index+1}`}))} onChange={setFactor}/></label>}

 <label>Código de seis dígitos<input ref={codeRef} className="mfaCodeInput" autoFocus aria-label="Código de seis dígitos" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>{const next=e.target.value.replace(/\D/g,'').slice(0,6);setCode(next);setError('');if(next.length===6&&!enrolling)void verify(next)}}/></label>{error&&<div role="alert" className="mfaFieldError"><AlertCircle size={16}/>{error}</div>}<button className="primary" disabled={busy} type="submit">Verificar</button></form>}
 </>}
 {error&&!(access.state==='challenge_required')&&<p role="alert">{error}</p>}<div className="actions">{(unavailable||locked)&&<button onClick={access.recheck}>Reintentar</button>}<button className="mfaLogoutLink" onClick={()=>void supabase.auth.signOut()}>Cerrar sesión</button></div></section></div>;
}
