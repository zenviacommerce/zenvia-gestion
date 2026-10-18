import type { OAuthContinuation } from './amazonOAuth';
export type AmazonOAuthResult='connected'|'failed'|'unavailable';
type AmazonOAuthEntry={login:boolean;continuation:OAuthContinuation|null;result?:AmazonOAuthResult};
declare global{interface Window{__amazonOAuthEntry?:AmazonOAuthEntry}}

// index.html captures and clears the query before any module, Auth client or telemetry runs.
export function readAmazonOAuthLaunch(location:Pick<Location,'pathname'>):OAuthContinuation|null{
  if(location.pathname!=='/amazon/oauth/login')return null;
  return window.__amazonOAuthEntry?.continuation??null;
}
export function isAmazonOAuthLogin(){return window.location.pathname==='/amazon/oauth/login'}
export function getAmazonOAuthResult():AmazonOAuthResult|undefined{return window.__amazonOAuthEntry?.result}
export function clearAmazonOAuthLaunch(){if(window.__amazonOAuthEntry)window.__amazonOAuthEntry.continuation=null}
export function amazonOAuthResultMessage(result:AmazonOAuthResult):string{
  return result==='connected'?'Amazon ha autorizado la cuenta. Completa la configuración de la integración.':result==='unavailable'?'La autorización de Amazon no está disponible. Puedes usar la conexión manual.':'No se pudo completar la autorización de Amazon. Inicia una nueva autorización.';
}
