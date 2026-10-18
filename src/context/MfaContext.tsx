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
 useEffect(()=>{statusRef.current=status},[status]);
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
   if(statusRef.current.state==='checking'||statusRef.current.state==='signed_out'){setStatus({state:'checking',factor_ids:[]});}
   try{
    const {data,error}=await client.auth.getSession();if(error)throw error;
    if(cancelled||current!==generation)return;
    const incomingId=data.session?.user.id||null;
    if(checkedUserRef.current!==null&&checkedUserRef.current!==incomingId){setStatus({state:'checking',factor_ids:[]});clearSensitive();}
    checkedUserRef.current=incomingId;
    setUserId(incomingId);
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
    lastCheckedAt.current=Date.now();
    setStatus(previous=>JSON.stringify(previous)===JSON.stringify(effective)?previous:effective);
   }catch{if(!cancelled&&current===generation){clearSensitive();setStatus({state:'temporarily_unavailable',factor_ids:[]});}}
  };
  const schedule=(urgent=false)=>{if(cancelled)return;if(!urgent&&statusRef.current.state==='ready'&&Date.now()-lastCheckedAt.current<1500)return;clearTimeout(timer);timer=setTimeout(()=>{if(!cancelled)void check()},urgent?0:150)};
  // Never await SDK methods inside the Auth callback: it can hold the Auth lock.
  const {data:{subscription}}=client.auth.onAuthStateChange((event)=>schedule(event==='SIGNED_OUT'||event==='SIGNED_IN'||event==='USER_UPDATED'));
  const resume=()=>{if(document.visibilityState!=='hidden')schedule()};
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
  void check();
  return()=>{cancelled=true;generation++;pendingRead?.abort();clearTimeout(timer);subscription.unsubscribe();window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume)};
 },[version]);
 return <Context.Provider value={{...status,userId,ready:status.state==='ready',recheck,requireRecent}}>{children}</Context.Provider>;
}
