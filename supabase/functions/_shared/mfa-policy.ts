/** SQL is the authority for current roles, session, approved factors and recovery locks.
 * Never pass caller-provided roles or claims to this guard. */
export async function assertMfaWithClient(
  req:Request,
  recent:boolean,
  clientForToken:(token:string)=>{rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<any>},
){
  const match=/^Bearer\s+(\S+)$/i.exec((req.headers.get('Authorization')||'').trim());
  if(!match)throw new Error('Sesión no válida.');
  const {error}=await clientForToken(match[1]).rpc('security_mfa_assert',{p_recent:recent});
  if(error)throw new Error(error.message||'MFA_UNAVAILABLE');
}

/** Bridge secret authentication is performed before this call. The actor UUID must
 * come from the trusted Platform request; missing actors fail closed under MFA. */
export async function assertBridgeMfaAllowed(admin:{rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<any>},actor:{id:string;email:string},action:string){
  const {data,error}=await admin.rpc('security_mfa_bridge_allowed',{p_actor_id:actor.id,p_actor_email:actor.email,p_action:action});
  if(error||data!==true)throw new Error('MFA_BRIDGE_DELEGATION_REQUIRED');
}
