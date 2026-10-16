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
 const recheck=useCallback(()=>{forceChallenge.current=false;setVersion(v=>v+1)},[]);
 const requireRecent=useCallback(()=>{forceChallenge.current=true;setVersion(v=>v+1)},[]);
 useEffect(()=>{
  const changed=()=>{forceChallenge.current=false;setStatus({state:'checking',factor_ids:[]});setUserId(null);setVersion(v=>v+1)};
  window.addEventListener('zenvia:tenant-changed',changed);
  window.addEventListener('zenvia:mfa-required',requireRecent);
  return()=>{window.removeEventListener('zenvia:tenant-changed',changed);window.removeEventListener('zenvia:mfa-required',requireRecent)};
 },[requireRecent]);
 useEffect(()=>{
  if(!hasActiveTenant()){setStatus({state:'signed_out',factor_ids:[]});setUserId(null);return;}
  const client=getActiveSupabase();
  let cancelled=false,generation=0;let pendingRead:AbortController|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
  const clearSensitive=()=>ensureViewCacheScope(getActiveTenant()?.workspace_id,null);
  const check=async()=>{
   const current=++generation;
   setStatus({state:'checking',factor_ids:[]});
   try{
    const {data,error}=await client.auth.getSession();if(error)throw error;
    if(cancelled||current!==generation)return;
    setUserId(data.session?.user.id||null);
    if(!data.session){clearSensitive();setStatus({state:'signed_out',factor_ids:[]});return;}
    pendingRead?.abort();
    const controller=new AbortController();pendingRead=controller;
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
    if(effective.state!=='ready')clearSensitive();
    setStatus(effective);
   }catch{if(!cancelled&&current===generation){clearSensitive();setStatus({state:'temporarily_unavailable',factor_ids:[]})}}
  };
  const schedule=()=>{generation++;pendingRead?.abort();setStatus({state:'checking',factor_ids:[]});clearTimeout(timer);timer=setTimeout(()=>{void check()},0)};
  // Never await SDK methods inside the Auth callback: it can hold the Auth lock.
  const {data:{subscription}}=client.auth.onAuthStateChange(()=>schedule());
  const resume=()=>{if(document.visibilityState!=='hidden')schedule()};
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
  void check();
  return()=>{cancelled=true;generation++;pendingRead?.abort();clearTimeout(timer);subscription.unsubscribe();window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume)};
 },[version]);
 return <Context.Provider value={{...status,userId,ready:status.state==='ready',recheck,requireRecent}}>{children}</Context.Provider>;
}
