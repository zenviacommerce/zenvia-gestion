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
