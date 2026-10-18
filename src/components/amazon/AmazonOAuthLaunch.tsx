import { useEffect, useRef, useState } from 'react';
import { beginAmazonAuthorization, loadAmazonOAuthCapability, type OAuthContinuation } from '../../services/amazonOAuth';

const safeError='No se pudo iniciar la autorización de Amazon. Inicia una nueva autorización.';
export function AmazonOAuthButton({continuation,navigate=(url:string)=>window.location.assign(url)}:{continuation?:OAuthContinuation;navigate?:(url:string)=>void}){
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const launching=useRef(false);
  useEffect(()=>{let active=true;void loadAmazonOAuthCapability().then(result=>{if(active)setEnabled(result.enabled===true)}).catch(()=>{if(active)setEnabled(false)});return()=>{active=false}},[]);
  const launch=async()=>{
    if(launching.current)return;
    launching.current=true;setBusy(true);setError('');
    try{const url=await beginAmazonAuthorization(continuation?{continuation}:{});navigate(url)}
    catch{setError(safeError);launching.current=false;setBusy(false)}
  };
  if(!enabled)return null;
  return <div><button type="button" className="secondary" disabled={busy} aria-busy={busy} onClick={()=>void launch()}>Conectar con Amazon</button>{error&&<p role="alert">{error}</p>}</div>;
}

// Rendered by App only after Zenvia session and workspace access checks succeed.
export function AmazonOAuthLaunch({continuation,onCancel}:{continuation:OAuthContinuation|null;onCancel:()=>void}){
  return <div className="authPage"><div className="authPanel"><h1>Autorizar Amazon</h1>{continuation?<><p>Continúa con la empresa de tu sesión de Zenvia. La cuenta quedará pendiente de completar su configuración.</p><AmazonOAuthButton continuation={continuation}/><p>Si la autorización no está disponible, vuelve a Integraciones para usar la conexión manual.</p></>:<p role="alert">El enlace de autorización no es válido. Inicia una nueva autorización desde Amazon o Integraciones.</p>}<button type="button" className="secondary" onClick={onCancel}>Volver a Integraciones</button></div></div>;
}
