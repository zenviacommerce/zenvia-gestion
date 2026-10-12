import { useEffect, useState } from 'react';
import { Fingerprint, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../services/supabase';
import { showError, showSuccess } from '../services/toast';
import { safeStorageGet, safeStorageSet } from '../services/browserStorage';

function isMobileOrTabletDevice(){
  if(typeof navigator==='undefined')return false;
  const uaData=(navigator as Navigator&{userAgentData?:{mobile?:boolean}}).userAgentData;
  if(uaData?.mobile===true)return true;
  const ua=navigator.userAgent||'';
  if(/Android|iPhone|iPad|iPod/i.test(ua))return true;
  return navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
}

function basePasskeySupport(){
  return typeof window!=='undefined' && window.isSecureContext && 'PublicKeyCredential' in window && !!navigator.credentials;
}

async function supportsDeviceBiometrics(){
  if(!isMobileOrTabletDevice()||!basePasskeySupport())return false;
  const availability=PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
  if(typeof availability!=='function')return true;
  try{return await availability.call(PublicKeyCredential);}
  catch{return true;}
}

function errorCode(error:unknown){
  return typeof error==='object'&&error&&'code' in error?String((error as {code?:unknown}).code||''):'';
}

function alreadyRegisteredAuthenticator(error:unknown){
  const code=errorCode(error);
  if(code==='webauthn_credential_exists')return true;
  const message=error instanceof Error?error.message:String(error||'');
  return /authenticator (?:was )?previously registered|authenticator already registered|credential (?:is )?already registered|credential already exists/i.test(message)
    || (error instanceof DOMException&&error.name==='InvalidStateError'&&/already|registered|credential/i.test(message));
}

function errorText(error:unknown){
  const code=errorCode(error);
  if(code==='passkey_disabled')return 'Face ID / huella todavía no está habilitado en Supabase para este dominio.';
  if(alreadyRegisteredAuthenticator(error))return 'Este Face ID ya está registrado. Si no puedes utilizarlo para entrar, revisa las llaves de acceso guardadas en tu cuenta antes de registrarlo otra vez.';
  if(code==='too_many_passkeys')return 'Has alcanzado el máximo de dispositivos biométricos registrados.';
  if(error instanceof DOMException&&error.name==='NotAllowedError')return 'Se canceló la verificación biométrica.';
  if(error instanceof Error)return error.message;
  return 'No se pudo activar Face ID / huella.';
}

export function PasskeySetup({userId,onVisibilityChange}:{userId:string;onVisibilityChange?:(visible:boolean)=>void}){
  const [supported,setSupported]=useState(false);
  const [registered,setRegistered]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [dismissed,setDismissed]=useState(false);
  const registeredKey=`zenvia-passkey-registered-${userId}`;
  const dismissedKey=`zenvia-passkey-dismissed-${userId}`;

  const visible=supported&&registered===false&&!dismissed;
  useEffect(()=>{onVisibilityChange?.(visible);return()=>onVisibilityChange?.(false)},[visible,onVisibilityChange]);

  useEffect(()=>{
    let active=true;
    setRegistered(null);
    setDismissed(safeStorageGet('session',dismissedKey)==='1');

    void (async()=>{
      const ok=await supportsDeviceBiometrics();
      if(!active)return;
      setSupported(ok);
      if(!ok){setRegistered(false);return;}

      const locallyRegistered=safeStorageGet('local',registeredKey)==='1';
      try{
        const {data,error}=await supabase.auth.passkey.list();
        if(error)throw error;
        const hasServerPasskey=Array.isArray(data)&&data.length>0;
        // The passkey list is account-wide, not device-specific. A passkey on an
        // iPhone must not hide the activation prompt on a new iPad/Mac. We only
        // suppress the prompt when this browser has successfully registered one.
        if(locallyRegistered&&hasServerPasskey){setRegistered(true);return;}
        if(locallyRegistered&&!hasServerPasskey)safeStorageSet('local',registeredKey,'0');
        setRegistered(false);
      }catch{
        // Keep the activation entry point visible. If the backend has passkeys
        // disabled, registerPasskey() will surface the precise error to the user.
        setRegistered(false);
      }
    })();

    return()=>{active=false};
  },[userId,dismissedKey,registeredKey]);

  const dismiss=()=>{
    safeStorageSet('session',dismissedKey,'1');
    setDismissed(true);
  };

  const register=async()=>{
    setBusy(true);
    try{
      const {error}=await supabase.auth.registerPasskey();
      if(error){
        // A synced iCloud/Google/Microsoft passkey may already exist even though
        // this browser has never stored our local activation marker.
        if(alreadyRegisteredAuthenticator(error)){
          // iCloud Keychain passkeys survive removal/reinstallation of the PWA.
          // Check the server before acknowledging an existing credential;
          // a local marker alone is not proof that a passkey still exists.
          const {data:existing,error:listError}=await supabase.auth.passkey.list();
          if(!listError&&Array.isArray(existing)&&existing.length>0){
            safeStorageSet('local',registeredKey,'1');
            setRegistered(true);
            showSuccess('Face ID ya estaba registrado. Puedes utilizarlo para entrar sin volver a crearlo.');
            return;
          }
        }
        throw error;
      }
      safeStorageSet('local',registeredKey,'1');
      setRegistered(true);
      showSuccess('Face ID / huella activado para este dispositivo.');
    }catch(error){showError(errorText(error))}
    finally{setBusy(false)}
  };

  if(!visible)return null;
  return <div className="passkeySetupBanner" role="region" aria-label="Activar acceso biométrico">
    <div className="passkeySetupIcon"><Fingerprint size={21}/></div>
    <div className="passkeySetupText"><strong>Activa Face ID / Touch ID</strong><span>Este dispositivo admite acceso biométrico. Actívalo una vez para entrar sin escribir la contraseña.</span></div>
    <button className="primary passkeySetupAction" onClick={register} disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ShieldCheck size={17}/>} {busy?'Activando…':'Activar ahora'}</button>
    <button className="passkeySetupClose" onClick={dismiss} title="Ahora no" aria-label="Ahora no"><X size={17}/></button>
  </div>;
}
