// Aggregate only this workspace. Unknown/failed counts must never become zero.
export async function readWorkspaceUsage(admin:any,workspaceId:string,now=new Date()){
  if(!workspaceId)throw new Error('Falta el cliente.');
  const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
  const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString();
  const count=async(query:PromiseLike<any>)=>{
    try{
      const result=await query;
      return !result.error&&Number.isSafeInteger(result.count)&&result.count>=0?result.count:null;
    }catch{return null;}
  };
  const [users,amazonAccounts,monthlyOrders]=await Promise.all([
    count(admin.from('app_users').select('user_id',{count:'exact',head:true}).eq('workspace_id',workspaceId).eq('active',true)),
    count(admin.from('amazon_accounts').select('id',{count:'exact',head:true}).eq('owner_id',workspaceId).neq('status','disabled')),
    count(admin.from('fulfillment_orders').select('id',{count:'exact',head:true}).eq('owner_id',workspaceId).gte('order_created_at',start).lt('order_created_at',end)),
  ]);
  return {workspaceId,users,amazonAccounts,monthlyOrders,observedAt:now.toISOString(),periodStart:start,periodEnd:end};
}
