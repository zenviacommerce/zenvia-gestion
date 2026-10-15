import { FormEvent, useState, useEffect } from 'react';
import {classifyAuthError, retryTransientAuth} from '../services/authResilience';
import './auth-gestion-brand.css';
import { Fingerprint, LoaderCircle, LockKeyhole, ReceiptText } from 'lucide-react';
import { getActiveTenant, resolveAndActivateTenant, resetLocalTenantSession, supabase, type TenantPublicConfig } from '../services/supabase';
import { emailError, normalizeEmail } from '../services/validation';
import { SelectField } from './forms/SelectField';

function authErrorMessage(error:unknown){
  const kind=classifyAuthError(error);
  if(kind==='temporarily-unavailable')return 'ZENVIA Gestión está tardando en responder. Tu sesión no se ha borrado. Inténtalo de nuevo.';
  return error instanceof Error?error.message:'No se pudo iniciar sesión.';
}

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

export function AuthScreen({onTenantChanged,initialMessage='',allowSessionReset=false}:{onTenantChanged?:()=>void;initialMessage?:string;allowSessionReset?:boolean}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [slowAuth,setSlowAuth]=useState(false);
  useEffect(()=>{if(!busy||busyStage!=='auth')return;const timer=window.setTimeout(()=>setSlowAuth(true),18000);return()=>window.clearTimeout(timer)},[busy,busyStage]);
  const [busyStage,setBusyStage]=useState<'tenant'|'auth'|null>(null);
  const [passkeyBusy,setPasskeyBusy]=useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [tenantChoices,setTenantChoices]=useState<Array<Pick<TenantPublicConfig,'workspace_id'|'slug'|'name'>>>([]);
  const [selectedTenant,setSelectedTenant]=useState('');
  const canUsePasskey=passkeySupported();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');setSlowAuth(false);
    const emailMessage=emailError(email,true);
    if(emailMessage){setMessage(emailMessage);return;}
    if(password.length<8){setMessage('La contraseña debe tener al menos 8 caracteres.');return;}
    setBusy(true);
    setBusyStage('tenant');
    try {
      const normalized=normalizeEmail(email);
      const resolution=await resolveAndActivateTenant(selectedTenant?{tenant:selectedTenant}:{email:normalized});
      if(resolution.status==='multiple'){
        setTenantChoices(resolution.tenants);
        if(!selectedTenant)setSelectedTenant(resolution.tenants[0]?.slug||'');
        setMessage('Selecciona tu empresa para continuar.');
        return;
      }
      if(resolution.status!=='resolved')throw new Error('No se ha encontrado una empresa activa para este usuario.');
      setBusyStage('auth');
      const { error } = await retryTransientAuth(()=>supabase.auth.signInWithPassword({ email: normalized, password }).then(result=>{if(result.error&&classifyAuthError(result.error)==='temporarily-unavailable')throw result.error;return result;}));
      if (error) throw error;
      onTenantChanged?.();
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally { setBusy(false);setBusyStage(null); }
  };

  const signInPasskey=async()=>{
    setMessage('');
    const activeTenant=getActiveTenant();
    if(!email.trim()&&activeTenant){
      setPasskeyBusy(true);
      try{
        const {error}=await supabase.auth.signInWithPasskey();
        if(error)throw error;
        onTenantChanged?.();
      }catch(error){setMessage(passkeyError(error));}
      finally{setPasskeyBusy(false)}
      return;
    }
    const emailMessage=emailError(email,true);
    if(emailMessage){setMessage('Indica tu email para localizar tu empresa antes de usar Face ID / huella.');return;}
    setPasskeyBusy(true);
    try{
      const normalized=normalizeEmail(email);
      const resolution=await resolveAndActivateTenant(selectedTenant?{tenant:selectedTenant}:{email:normalized});
      if(resolution.status==='multiple'){
        setTenantChoices(resolution.tenants);
        if(!selectedTenant)setSelectedTenant(resolution.tenants[0]?.slug||'');
        setMessage('Selecciona tu empresa para continuar.');
        return;
      }
      if(resolution.status!=='resolved')throw new Error('No se ha encontrado una empresa activa para este usuario.');
      const {error}=await supabase.auth.signInWithPasskey();
      if(error)throw error;
      onTenantChanged?.();
    }catch(error){setMessage(passkeyError(error));}
    finally{setPasskeyBusy(false)}
  };

  return <div className="authPage">
    <div className="authPanel">
      <div className="authLogo authGestionLogo" aria-label="Zenvia Gestión"><img src="/zenvia-brand-symbol-20261012.svg" alt="" width="42" height="42"/><div><strong>ZENVIA</strong><span>GESTIÓN</span></div></div>
      <div className="authHeroIcon"><ReceiptText/></div>
      <h1>Accede a ZENVIA Gestión</h1>
      <p>Compras, gastos, clientes, ventas y facturación en un único espacio privado.</p>
      {canUsePasskey&&<><button type="button" className="authPasskeyButton" onClick={signInPasskey} disabled={passkeyBusy||busy}>{passkeyBusy?<LoaderCircle className="spin" size={18}/>:<Fingerprint size={20}/>} {passkeyBusy?'Verificando…':'Entrar con Face ID / huella'}</button><div className="authPasskeyDivider"><span>o con contraseña</span></div></>}
      <form onSubmit={submit} className="authForm" noValidate>
        <label>Email<input type="email" required inputMode="email" autoComplete="username" value={email} onChange={e => {setEmail(e.target.value);setTenantChoices([]);setSelectedTenant('')}} placeholder="usuario@empresa.com"/></label>
        {tenantChoices.length>1&&<label>Selecciona tu empresa<SelectField ariaLabel="Selecciona tu empresa" value={selectedTenant} options={tenantChoices.map(tenant=>({value:tenant.slug,label:tenant.name}))} onChange={setSelectedTenant}/></label>}
        <label>Contraseña<input type="password" required minLength={8} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"/></label>
        <button className="primary authSubmit" disabled={busy||passkeyBusy}><LockKeyhole size={17}/>{busy ? (busyStage==='tenant'?'Localizando empresa…':'Verificando acceso…') : 'Entrar'}</button>
      </form>
      {slowAuth&&busy&&busyStage==='auth'&&<div className="authMessage">La autenticación está tardando más de lo normal. Seguimos intentándolo…</div>}
      {message && <div className="authMessage">{message}</div>}
      {allowSessionReset&&<button type="button" className="secondary" onClick={()=>{resetLocalTenantSession();window.location.reload()}}>Restablecer acceso en este dispositivo</button>}
      {canUsePasskey&&<p className="authPasskeyHint">La primera vez debes activar la biometría desde dentro de la aplicación.</p>}
      <div className="authMessage">Las cuentas se crean y administran desde la propia aplicación.</div>
    </div>
  </div>;
}
