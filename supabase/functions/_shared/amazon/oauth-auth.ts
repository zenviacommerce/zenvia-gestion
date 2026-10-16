import {requireWorkspaceEntitlement} from '../saas/entitlements.ts';
export type OAuthContext={userId:string;workspaceId:string;ownerId:string};
export class AmazonOAuthAuthError extends Error{status:number;constructor(status:number){super('Amazon authorization unavailable.');this.status=status;}}
export async function authenticateAmazonOAuth(req:Request,admin:any,requestedWorkspaceId?:string):Promise<OAuthContext>{
  const auth=req.headers.get('authorization')||'';if(!/^Bearer [^\s]+$/i.test(auth))throw new AmazonOAuthAuthError(401);
  const {data,error}=await admin.auth.getUser(auth.slice(7));if(error||!data?.user?.id)throw new AmazonOAuthAuthError(401);
  const membership=await admin.from('app_users').select('user_id,workspace_id,data_owner_id,role,active').eq('user_id',data.user.id).maybeSingle();
  const p=membership.data;
  if(membership.error||p?.active!==true||p.user_id!==data.user.id||p.role!=='admin'||!p.workspace_id||!p.data_owner_id||(requestedWorkspaceId!==undefined&&requestedWorkspaceId!==p.workspace_id))throw new AmazonOAuthAuthError(403);
  const workspace=await admin.from('workspaces').select('id,status').eq('id',p.workspace_id).maybeSingle();
  if(workspace.error||workspace.data?.id!==p.workspace_id||!['active','trialing'].includes(workspace.data?.status))throw new AmazonOAuthAuthError(403);
  const owner=await admin.from('workspaces').select('id,status').eq('id',p.data_owner_id).maybeSingle();
  if(owner.error||owner.data?.id!==p.data_owner_id||!['active','trialing'].includes(owner.data?.status))throw new AmazonOAuthAuthError(403);
  return {userId:data.user.id,workspaceId:p.workspace_id,ownerId:p.data_owner_id};
}
export async function authorizeAmazonOAuthEntitlement(admin:any,context:OAuthContext):Promise<void>{await requireWorkspaceEntitlement(admin,context.workspaceId,'integration.amazon','Amazon authorization unavailable.');}
export type AmazonOAuthActor={actor_user_id:string;actor_owner_id:string;actor_session_id:string;actor_factor_id:string;mfa_verified_at:number};
export type AmazonOAuthHumanRpc=(req:Request)=>PromiseLike<{data?:unknown;error?:unknown}>;
export async function readTrustedAmazonOAuthActor(req:Request,context:OAuthContext,humanRpc?:AmazonOAuthHumanRpc):Promise<AmazonOAuthActor>{
  if(!humanRpc)throw new AmazonOAuthAuthError(403);
  const result=await humanRpc(req);const actor=result.data as AmazonOAuthActor;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(result.error||!actor||typeof actor!=='object'||actor.actor_user_id!==context.userId||actor.actor_owner_id!==context.ownerId||!uuid.test(actor.actor_session_id)||!uuid.test(actor.actor_factor_id)||typeof actor.mfa_verified_at!=='number'||!Number.isFinite(actor.mfa_verified_at)||actor.mfa_verified_at<=0)throw new AmazonOAuthAuthError(403);
  return {actor_user_id:actor.actor_user_id,actor_owner_id:actor.actor_owner_id,actor_session_id:actor.actor_session_id,actor_factor_id:actor.actor_factor_id,mfa_verified_at:actor.mfa_verified_at};
}
export function createAmazonOAuthHumanRpc(createClient:(url:string,key:string,options:any)=>any,envGet:(name:string)=>string|undefined):AmazonOAuthHumanRpc{
  return async(req:Request)=>{
    const auth=req.headers.get('Authorization')||'';if(!/^Bearer [^\s]+$/i.test(auth))throw new AmazonOAuthAuthError(401);
    const url=envGet('SUPABASE_URL')||'';let key=envGet('SUPABASE_ANON_KEY')||'';
    try{const value=JSON.parse(envGet('SUPABASE_PUBLISHABLE_KEYS')||'{}')?.default;if(typeof value==='string'&&value.trim())key=value.trim();}catch{/* Legacy anonymous API key remains usable. */}
    if(!url||!key)throw new AmazonOAuthAuthError(403);
    return await createClient(url,key,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}}).rpc('security_mfa_oauth_start_context');
  };
}
export async function amazonOAuthMfaReady(admin:any):Promise<boolean>{try{const {data,error}=await admin.rpc('integration_amazon_oauth_hooks_ready');return !error&&data===true;}catch{return false;}}
