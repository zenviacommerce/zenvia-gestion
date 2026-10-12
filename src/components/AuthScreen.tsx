import { FormEvent, useState } from 'react';
import { ZENVIA_LOGO } from '../branding';
import { Fingerprint, LoaderCircle, LockKeyhole, ReceiptText } from 'lucide-react';
import { getActiveTenant, resolveAndActivateTenant, resetLocalTenantSession, supabase, type TenantPublicConfig } from '../services/supabase';
import { emailError, normalizeEmail } from '../services/validation';
import { SelectField } from './forms/SelectField';

function authErrorMessage(error:unknown){
  const value=error&&typeof error==='object'?error as {message?:unknown;status?:unknown;code?:unknown}:null;
  const message=typeof value?.message==='string'?value.message.trim():'';
  const status=Number(value?.status||0);
  const code=typeof value?.code==='string'?value.code:'';
  if(status>=500||['request_timeout','unexpected_failure'].includes(code)||!message||message==='{}'||/context deadline|unexpected eof|failed to fetch|timeout/i.test(message)){
    return 'ZENVIA Gestión está tardando en responder. Inténtalo de nuevo en unos segundos.';
  }
  return message;
}

/** A stalled GoTrue request must never leave the user locked on "Entrando…". */
class AuthDeadlineError extends Error {
  constructor() {
    super('El servidor de autenticación no ha respondido en 18 segundos. Revisa tu conexión y vuelve a intentarlo. Si persiste, restablece el acceso de este dispositivo.');
    this.name='AuthDeadlineError';
  }
}

function withAuthDeadline<T>(promise:Promise<T>):Promise<T> {
  return new Promise<T>((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(new AuthDeadlineError()),18000);
    promise.then(value=>{window.clearTimeout(timer);resolve(value)},error=>{window.clearTimeout(timer);reject(error)});
  });
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
  const [busyStage,setBusyStage]=useState<'tenant'|'auth'|null>(null);
  const [showLocalRecovery,setShowLocalRecovery]=useState(false);
  const [passkeyBusy,setPasskeyBusy]=useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [tenantChoices,setTenantChoices]=useState<Array<Pick<TenantPublicConfig,'workspace_id'|'slug'|'name'>>>([]);
  const [selectedTenant,setSelectedTenant]=useState('');
  const canUsePasskey=passkeySupported();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    const emailMessage=emailError(email,true);
    if(emailMessage){setMessage(emailMessage);return;}
    if(password.length<8){setMessage('La contraseña debe tener al menos 8 caracteres.');return;}
    setBusy(true);
    setBusyStage('tenant');
    setShowLocalRecovery(false);
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
      const { error } = await withAuthDeadline(supabase.auth.signInWithPassword({ email: normalized, password }));
      if (error) throw error;
      onTenantChanged?.();
    } catch (error) {
      setMessage(authErrorMessage(error));
      if(error instanceof AuthDeadlineError)setShowLocalRecovery(true);
    } finally { setBusy(false);setBusyStage(null); }
  };

  const signInPasskey=async()=>{
    setMessage('');
    const activeTenant=getActiveTenant();
    if(!email.trim()&&activeTenant){
      setPasskeyBusy(true);
      try{
        const {error}=await withAuthDeadline(supabase.auth.signInWithPasskey());
        if(error)throw error;
        onTenantChanged?.();
      }catch(error){setMessage(passkeyError(error));if(error instanceof AuthDeadlineError)setShowLocalRecovery(true)}
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
      const {error}=await withAuthDeadline(supabase.auth.signInWithPasskey());
      if(error)throw error;
      onTenantChanged?.();
    }catch(error){setMessage(passkeyError(error));if(error instanceof AuthDeadlineError)setShowLocalRecovery(true)}
    finally{setPasskeyBusy(false)}
  };

  return <div className="authPage">
    <div className="authPanel">
      <div className="authLogo"><img src={ZENVIA_LOGO} alt="ZENVIA COMMERCE"/><span>Gestión empresarial</span></div>
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
      {message && <div className="authMessage">{message}</div>}
      {(allowSessionReset||showLocalRecovery)&&<button type="button" className="secondary" onClick={()=>{resetLocalTenantSession();window.location.reload()}}>Restablecer acceso en este dispositivo</button>}
      {canUsePasskey&&<p className="authPasskeyHint">La primera vez debes activar la biometría desde dentro de la aplicación.</p>}
      <div className="authMessage">Las cuentas se crean y administran desde la propia aplicación.</div>
    </div>
  </div>;
}
