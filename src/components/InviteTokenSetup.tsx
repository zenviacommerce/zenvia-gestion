import { FormEvent, useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { ZENVIA_LOGO } from '../branding';
import { supabase } from '../services/supabase';

export function InviteTokenSetup({tokenHash,onComplete}:{tokenHash:string;onComplete:()=>Promise<void>|void}){
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [verified,setVerified]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    setMessage('');
    if(password.length<8){setMessage('La contraseña debe tener al menos 8 caracteres.');return;}
    if(password!==confirm){setMessage('Las contraseñas no coinciden.');return;}
    setBusy(true);
    try{
      let userMetadata:Record<string,unknown>={};
      if(!verified){
        const {data,error}=await supabase.auth.verifyOtp({token_hash:tokenHash,type:'invite'});
        if(error)throw error;
        if(!data.session||!data.user)throw new Error('No se pudo validar la invitación.');
        userMetadata={...(data.user.user_metadata||{})};
        setVerified(true);
      }else{
        const {data,error}=await supabase.auth.getUser();
        if(error)throw error;
        if(!data.user)throw new Error('La sesión de activación ya no está disponible.');
        userMetadata={...(data.user.user_metadata||{})};
      }

      const {error:updateError}=await supabase.auth.updateUser({
        password,
        data:{...userMetadata,onboarding_pending:false},
      });
      if(updateError)throw updateError;
      await onComplete();
    }catch(error){
      const raw=error instanceof Error?error.message:'No se pudo activar la cuenta.';
      setMessage(/expired|invalid|token/i.test(raw)
        ?'La invitación ha caducado o ya se ha utilizado. Solicita una nueva invitación al administrador.'
        :raw);
    }finally{
      setBusy(false);
    }
  };

  return <div className="authPage">
    <div className="authPanel">
      <div className="authLogo"><img src={ZENVIA_LOGO} alt="ZENVIA COMMERCE"/><span>Gestión empresarial</span></div>
      <div className="authHeroIcon"><KeyRound/></div>
      <h1>Activa tu acceso</h1>
      <p>Crea tu contraseña antes de entrar por primera vez en ZENVIA Gestión.</p>
      <form onSubmit={submit} className="authForm" noValidate>
        <label>Nueva contraseña<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 8 caracteres"/></label>
        <label>Repite la contraseña<input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repite la contraseña"/></label>
        <button className="primary authSubmit" disabled={busy}><KeyRound size={17}/>{busy?<><LoaderCircle className="spin" size={17}/> Activando…</>:'Crear contraseña y entrar'}</button>
      </form>
      {message&&<div className="authMessage inviteSetupError">{message}</div>}
    </div>
  </div>;
}
