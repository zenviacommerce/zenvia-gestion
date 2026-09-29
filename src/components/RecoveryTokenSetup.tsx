import { FormEvent, useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { ZENVIA_LOGO } from '../branding';
import { supabase } from '../services/supabase';

export function RecoveryTokenSetup({tokenHash,onComplete}:{tokenHash:string;onComplete:()=>Promise<void>|void}){
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
      if(!verified){
        const {data,error}=await supabase.auth.verifyOtp({token_hash:tokenHash,type:'recovery'});
        if(error)throw error;
        if(!data.session||!data.user)throw new Error('No se pudo validar el enlace de recuperación.');
        setVerified(true);
      }
      const {error:updateError}=await supabase.auth.updateUser({password});
      if(updateError)throw updateError;
      await onComplete();
    }catch(error){
      const raw=error instanceof Error?error.message:'No se pudo restablecer la contraseña.';
      setMessage(/expired|invalid|token/i.test(raw)
        ?'El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.'
        :raw);
    }finally{
      setBusy(false);
    }
  };

  return <div className="authPage">
    <div className="authPanel">
      <div className="authLogo"><img src={ZENVIA_LOGO} alt="ZENVIA COMMERCE"/><span>Gestión empresarial</span></div>
      <div className="authHeroIcon"><KeyRound/></div>
      <h1>Crea una contraseña nueva</h1>
      <p>Introduce la nueva contraseña que quieres utilizar para acceder a ZENVIA Gestión.</p>
      <form onSubmit={submit} className="authForm" noValidate>
        <label>Nueva contraseña<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 8 caracteres"/></label>
        <label>Repite la contraseña<input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repite la contraseña"/></label>
        <button className="primary authSubmit" disabled={busy}><KeyRound size={17}/>{busy?<><LoaderCircle className="spin" size={17}/> Guardando…</>:'Guardar nueva contraseña'}</button>
      </form>
      {message&&<div className="authMessage inviteSetupError">{message}</div>}
    </div>
  </div>;
}
