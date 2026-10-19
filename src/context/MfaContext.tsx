import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {getActiveSupabase,hasActiveTenant,getActiveTenant} from '../services/supabase';
import {ensureViewCacheScope} from '../services/viewCache';
import type {MfaStatus} from '../services/mfa';
type Access=MfaStatus&{ready:boolean;userId:string|null;recheck:()=>void;requireRecent:()=>void};
const Context=createContext<Access>({state:'checking',factor_ids:[],ready:false,userId:null,recheck:()=>{},requireRecent:()=>{}});
export function useMfaAccess(){return useContext(Context)}
export function MfaProvider({children}:{children:ReactNode}){
 const [status,setStatus]=useState<MfaStatus>({state:hasActiveTenant()?'checking':'signed_out',factor_ids:[]});
 const [userId,setUserId]=useState<string|null>(null);
 const [version,setVersion]=useState(0);
 const forceChallenge=useRef(false);
 const statusRef=useRef(status);
 const checkedUserRef=useRef<string|null>(null);
 const lastCheckedAt=useRef(0);
 const restrictedUser=useRef<string|null>(null);
 useEffect(()=>{statusRef.current=status},[status]);
 const recheck=useCallback(()=>{forceChallenge.current=false;setVersion(v=>v+1)},[]);
 const requireRecent=useCallback(()=>{forceChallenge.current=true;setVersion(v=>v+1)},[]);
 useEffect(()=>{
  const changed=()=>{restrictedUser.current=null;forceChallenge.current=false;setStatus({state:'checking',factor_ids:[]});setUserId(null);setVersion(v=>v+1)};
  window.addEventListener('zenvia:tenant-changed',changed);
  window.addEventListener('zenvia:mfa-required',requireRecent);
  return()=>{window.removeEventListener('zenvia:tenant-changed',changed);window.removeEventListener('zenvia:mfa-required',requireRecent)};
 },[requireRecent]);
 useEffect(()=>{
  if(!hasActiveTenant()){setStatus({state:'signed_out',factor_ids:[]});setUserId(null);return;}
  const client=getActiveSupabase();
  // Explicit release setting; unknown/enabled configurations continue to fail
  // closed. Backend RLS/Edge MFA checks remain authoritative for operations.
  const enforcementDisabled=import.meta.env.VITE_MFA_ENFORCEMENT_ENABLED==='false';
  let cancelled=false,generation=0,inFlight=false,rerun=false,readAttempts=0;let retryTimer:ReturnType<typeof setTimeout>|undefined;let pendingRead:AbortController|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
  const clearSensitive=()=>ensureViewCacheScope(getActiveTenant()?.workspace_id,null);
  // Used only to coalesce checks, never to authorize a session. Server remains authority.
  const identity=(session:{user:{id:string};access_token:string}|null)=>{
   if(!session)return null;
   let sessionId='unknown';
   try{const payload=JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(typeof payload.session_id==='string')sessionId=payload.session_id;}catch{/* Synthetic/unknown tokens are still verified by the server. */}
   return session.user.id+':'+sessionId;
  };
  let observedIdentity:string|null|undefined;

  const check=async()=>{
   if(cancelled||inFlight)return;
   inFlight=true;
   const current=++generation;
   let hasSession=false;
   let disabledStartup=false;
   if(statusRef.current.state==='checking'||statusRef.current.state==='signed_out'){setStatus({state:'checking',factor_ids:[]});}
   try{
    const {data,error}=await client.auth.getSession();if(error)throw error;
    if(cancelled||current!==generation)return;
    const incomingId=data.session?.user.id||null;
    if(checkedUserRef.current!==null&&checkedUserRef.current!==incomingId){setStatus({state:'checking',factor_ids:[]});clearSensitive();}
    checkedUserRef.current=incomingId;
    setUserId(incomingId);
    if(!data.session){observedIdentity=null;restrictedUser.current=null;clearSensitive();setStatus({state:'signed_out',factor_ids:[]});return;}
    observedIdentity=identity(data.session);
    hasSession=true;
    disabledStartup=enforcementDisabled&&!forceChallenge.current&&restrictedUser.current!==incomingId;
    if(disabledStartup)setStatus(previous=>previous.state==='ready'?previous:{state:'ready',factor_ids:[]});
    pendingRead?.abort();
    const controller=new AbortController();pendingRead=controller;
    readAttempts++;
    const request=client.rpc('security_mfa_status');
    const boundedRequest=typeof request.abortSignal==='function'?request.abortSignal(controller.signal):request;
    let deadline:ReturnType<typeof setTimeout>|undefined;
    let onAbort:()=>void=()=>{};
    const interrupted=new Promise<never>((_,reject)=>{
     onAbort=()=>reject(new Error('MFA_READ_ABORTED'));
     controller.signal.addEventListener('abort',onAbort,{once:true});
     deadline=setTimeout(()=>{controller.abort()},6000);
    });
    let result:Awaited<typeof request>;
    try{result=await Promise.race([Promise.resolve(boundedRequest),interrupted]);}
    finally{clearTimeout(deadline);controller.signal.removeEventListener('abort',onAbort);if(pendingRead===controller)pendingRead=undefined;}
    if(result.error)throw result.error;
    if(cancelled||current!==generation)return;
    const next=result.data as MfaStatus;
    if(!next||!['ready','enrollment_required','challenge_required','recovery_locked'].includes(next.state)||!Array.isArray(next.factor_ids))throw new Error('MFA_UNAVAILABLE');
    if(next.factor_ids.some(id=>typeof id!=='string'))throw new Error('MFA_UNAVAILABLE');
    const effective=forceChallenge.current&&next.state==='ready'?{...next,state:'challenge_required' as const}:next;
    restrictedUser.current=effective.state==='ready'?null:incomingId;
    if(effective.state!=='ready')clearSensitive();
    readAttempts=0;clearTimeout(retryTimer);retryTimer=undefined;
    lastCheckedAt.current=Date.now();
    setStatus(previous=>JSON.stringify(previous)===JSON.stringify(effective)?previous:effective);
   }catch{if(!cancelled&&current===generation){
    if(disabledStartup&&hasSession&&!forceChallenge.current){setStatus(previous=>previous.state==='ready'?previous:{state:'ready',factor_ids:[]});}
    else{
     clearSensitive();setStatus({state:'temporarily_unavailable',factor_ids:[]});
     // Three reads maximum. Focus/token events cannot restart the budget.
     if(hasSession&&readAttempts<3){retryTimer=setTimeout(()=>{retryTimer=undefined;void check()},[500,1500][readAttempts-1]);}
    }
   }}finally{
    inFlight=false;
    if(rerun&&!cancelled){
     rerun=false;clearTimeout(retryTimer);retryTimer=undefined;
     if(readAttempts>=3){
      if(disabledStartup&&hasSession&&!forceChallenge.current)setStatus(previous=>previous.state==='ready'?previous:{state:'ready',factor_ids:[]});
      else{clearSensitive();setStatus({state:'temporarily_unavailable',factor_ids:[]});}
     }
     else retryTimer=setTimeout(()=>{retryTimer=undefined;void check()},[500,1500][Math.max(0,readAttempts-1)]);
    }
   }
  };
  const schedule=(urgent=false,supersede=false)=>{
   if(cancelled)return;
   if(inFlight){if(supersede){generation++;rerun=true;pendingRead?.abort();}return;}
   if(retryTimer||readAttempts>=3)return;
   if(!urgent&&statusRef.current.state==='ready'&&Date.now()-lastCheckedAt.current<1500)return;
   clearTimeout(timer);timer=setTimeout(()=>{if(!cancelled)void check()},urgent?0:150);
  };
  // Never await SDK methods inside the Auth callback: it can hold the Auth lock.
  const {data:{subscription}}=client.auth.onAuthStateChange((event,nextSession)=>{
   const nextIdentity=identity(nextSession);
   if(event==='SIGNED_OUT'||event==='USER_UPDATED'||(observedIdentity!==undefined&&nextIdentity!==observedIdentity)){
    // Real sign-out/session/identity changes invalidate the old UI immediately.
    // Same-session TOKEN_REFRESHED cannot reset the exhausted read budget.
    generation++;rerun=false;pendingRead?.abort();clearTimeout(timer);clearTimeout(retryTimer);
    if(checkedUserRef.current!==nextSession?.user.id)restrictedUser.current=null;
    checkedUserRef.current=nextSession?.user.id||null;
    clearSensitive();setUserId(nextSession?.user.id||null);
    setStatus({state:nextSession?'checking':'signed_out',factor_ids:[]});
    setVersion(v=>v+1);return;
   }
   observedIdentity=nextIdentity;
   schedule(event==='SIGNED_IN',event!=='INITIAL_SESSION');
  });
  const resume=()=>{if(document.visibilityState!=='hidden')schedule()};
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
  void check();
  return()=>{cancelled=true;generation++;pendingRead?.abort();clearTimeout(timer);clearTimeout(retryTimer);subscription.unsubscribe();window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume)};
 },[version]);
 return <Context.Provider value={{...status,userId,ready:status.state==='ready',recheck,requireRecent}}>{children}</Context.Provider>;
}
