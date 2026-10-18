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

/** Platform bridge is a trusted service-to-service channel. The actor email
 * comes from authenticated Zenvia Platform; target IDs are rechecked by SQL.
 * Never use the legacy global flag without per-operation cohort scoping. */
export type BridgeMfaScope={
  action:string;
  actorEmail:string;
  targetUserId?:string|null;
  workspaceId?:string|null;
};
export async function assertBridgeMfaAllowed(
 admin:{rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<any>},
 scope:BridgeMfaScope,
){
 if(!scope?.action)throw new Error('MFA_BRIDGE_DELEGATION_REQUIRED');
 const {data,error}=await admin.rpc('security_mfa_bridge_allowed',{
  p_action:scope.action,
  p_actor_email:scope.actorEmail||'',
  p_target_user_id:scope.targetUserId||null,
  p_workspace_id:scope.workspaceId||null,
 });
 if(error||data!==true)throw new Error('MFA_BRIDGE_DELEGATION_REQUIRED');
}
