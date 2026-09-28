import { FormEvent, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ZENVIA_LOGO } from '../branding';
import { Fingerprint, LoaderCircle, LockKeyhole, ReceiptText } from 'lucide-react';
import {
  activateTenant,clearActiveTenant,getActiveSupabase,getActiveTenantConnection,
} from '../services/supabase';
import { resolveTenantForAuthentication } from '../services/tenant';
import { emailError, normalizeEmail } from '../services/validation';

function passkeySupported(){
  return typeof window!=='undefined' && window.isSecureContext && 'PublicKeyCredential' in window && !!navigator.credentials;
}

function passkeyError(error:unknown){
  const code=typeof error==='object'&&error&&'code' in error?String((error as {code?:unknown}).code||''):'';
  if(code==='passkey_disabled')return 'El acceso con Face ID / huella todavía no está habilitado para ZENVIA Gestión.';
  if(code==='webauthn_credential_not_found')return 'No hay una passkey de ZENVIA Gestión guardada en este dispositivo.';
  if(error instanceof DOMException&&error.name==='NotAllowedError')return 'Se canceló la verificación biométrica.';
  if(error instanceof Error)return error.message;
  return 'No se pudo iniciar sesión con Face ID / huella.';
}

export function AuthScreen({
  onAuthenticated,onTenantChanged,initialMessage='',
}:{
  onAuthenticated:(session:Session)=>void;
  onTenantChanged?:()=>void;
  initialMessage?:string;
}) {
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [passkeyBusy,setPasskeyBusy]=useState(false);
  const [message,setMessage]=useState(initialMessage);
  const [tenantLabel,setTenantLabel]=useState(()=>getActiveTenantConnection()?.slug||'');
  const canUsePasskey=passkeySupported();

  const prepareClient=async(emailForResolution?:string)=>{
    const connection=await resolveTenantForAuthentication(emailForResolution);
    await activateTenant(connection);
    setTenantLabel(connection.slug);
    onTenantChanged?.();
    return getActiveSupabase();
  };

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    setMessage('');
    const emailMessage=emailError(email,true);
    if(emailMessage){setMessage(emailMessage);return;}
    if(password.length<8){setMessage('La contraseña debe tener al menos 8 caracteres.');return;}
    setBusy(true);
    try{
      const normalized=normalizeEmail(email);
      const client=await prepareClient(normalized);
      const {data,error}=await client.auth.signInWithPassword({email:normalized,password});
      if(error)throw error;
      if(!data.session)throw new Error('No se pudo abrir la sesión.');
      onAuthenticated(data.session);
    }catch(error){
      setMessage(error instanceof Error?error.message:'No se pudo iniciar sesión.');
    }finally{setBusy(false)}
  };

  const signInPasskey=async()=>{
    setMessage('');
    const emailMessage=email?emailError(email,true):'';
    if(emailMessage){setMessage(emailMessage);return;}
    setPasskeyBusy(true);
    try{
      const client=await prepareClient(email?normalizeEmail(email):undefined);
      const {error}=await client.auth.signInWithPasskey();
      if(error)throw error;
      const {data}=await client.auth.getSession();
      if(!data.session)throw new Error('No se pudo abrir la sesión biométrica.');
      onAuthenticated(data.session);
    }catch(error){setMessage(passkeyError(error))}
    finally{setPasskeyBusy(false)}
  };

  const changeCompany=()=>{
    clearActiveTenant({forget:true});
    setTenantLabel('');
    setMessage('Indica tu email para localizar la empresa correcta.');
    onTenantChanged?.();
  };

  return <div className="authPage">
    <div className="authPanel">
      <div className="authLogo"><img src={ZENVIA_LOGO} alt="ZENVIA COMMERCE"/><span>Gestión empresarial</span></div>
      <div className="authHeroIcon"><ReceiptText/></div>
      <h1>Accede a ZENVIA Gestión</h1>
      <p>Compras, gastos, clientes, ventas y facturación en un único espacio privado.</p>
      {tenantLabel&&<div className="authMessage">Empresa: <strong>{tenantLabel}</strong> · <button type="button" className="link" onClick={changeCompany}>Cambiar empresa</button></div>}
      {canUsePasskey&&<><button type="button" className="authPasskeyButton" onClick={signInPasskey} disabled={passkeyBusy||busy}>{passkeyBusy?<LoaderCircle className="spin" size={18}/>:<Fingerprint size={20}/>} {passkeyBusy?'Verificando…':'Entrar con Face ID / huella'}</button><div className="authPasskeyDivider"><span>o con contraseña</span></div></>}
      <form onSubmit={submit} className="authForm" noValidate>
        <label>Email<input type="email" required inputMode="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="usuario@empresa.com"/></label>
        <label>Contraseña<input type="password" required minLength={8} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></label>
        <button className="primary authSubmit" disabled={busy||passkeyBusy}><LockKeyhole size={17}/>{busy?'Entrando…':'Entrar'}</button>
      </form>
      {message&&<div className="authMessage">{message}</div>}
      {canUsePasskey&&<p className="authPasskeyHint">La primera vez debes activar la biometría desde dentro de la aplicación.</p>}
      <div className="authMessage">Las cuentas se crean y administran desde la propia aplicación.</div>
    </div>
  </div>;
}
