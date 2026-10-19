import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {reconcileOperationalAmazonStates} from '../supabase/functions/_shared/amazon/orders.ts';

function fakeAdmin(rows:Array<Record<string,unknown>>){
  const updates:Array<Record<string,unknown>>=[];
  const reads:{count:number}={count:0};
  return {
    updates,reads,
    from(table:string){
      expect(table).toBe('fulfillment_orders');
      return {
        select(){
          reads.count++;
          return {
            eq(){return this},
            in(_column:string,ids:string[]){
              return Promise.resolve({data:rows.filter(row=>ids.includes(String(row.order_number))),error:null});
            },
          };
        },
        update(patch:Record<string,unknown>){
          updates.push(patch);
          return {
            eq(){return this},
            then(resolve:(result:{error:null})=>unknown){return Promise.resolve({error:null}).then(resolve)},
          };
        },
      };
    },
  };
}
const stamp='2026-10-19T08:00:00.000Z';
function baseOrder(n:number){return{
  id:'fixture-'+n,order_number:'ORDER-'+n,source_status:'Unshipped',
  order_updated_at:stamp,tracking_number:null,carrier_name:null,carrier_code:null,
  shipping_service_name:null,tracking_status_code:null,tracking_status_message:null,
  fulfilled_at:null,
};}
function amazonOrder(n:number,status='Unshipped'){return{
  orderId:'ORDER-'+n,lastUpdatedTime:stamp,fulfillment:{fulfillmentStatus:status},
};}

describe('Amazon order sync write coalescing',()=>{
  it('avoids 100 obsolete MVCC row writes for 100 unchanged orders',async()=>{
    const admin=fakeAdmin(Array.from({length:100},(_,i)=>baseOrder(i)));
    const result=await reconcileOperationalAmazonStates(admin,Array.from({length:100},(_,i)=>amazonOrder(i)),'owner');
    expect(result).toEqual({inspected:100,updated:0,unchanged:100});
    expect(admin.reads.count).toBe(1);
    expect(admin.updates).toHaveLength(0);
  });
  it('updates changed business fields but not a sync-only heartbeat',async()=>{
    const admin=fakeAdmin([baseOrder(1)]);
    const result=await reconcileOperationalAmazonStates(admin,[amazonOrder(1,'Shipped')],'owner');
    expect(result.updated).toBe(1);
    expect(admin.updates).toHaveLength(1);
    expect(admin.updates[0].source_status).toBe('Shipped');
    expect(admin.updates[0].last_synced_at).toBeDefined();
  });
  it('bounds select requests to batches of 100 rather than per order',async()=>{
    const n=205,admin=fakeAdmin(Array.from({length:n},(_,i)=>baseOrder(i)));
    const result=await reconcileOperationalAmazonStates(admin,Array.from({length:n},(_,i)=>amazonOrder(i)),'owner');
    expect(result.unchanged).toBe(n);
    expect(admin.reads.count).toBe(3);
    expect(admin.updates).toHaveLength(0);
  });
});
describe('PostgREST pressure contracts',()=>{
  it('does not leak raw Amazon sync job counts to authenticated users',()=>{
    const migration=readFileSync('supabase/migrations/20261019113000_orders_pool_status_dashboard.sql','utf8');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.amazon_sync_job_counts(uuid,uuid) FROM PUBLIC,anon,authenticated;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.amazon_sync_job_counts(uuid,uuid) TO service_role;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.orders_dashboard_page_v1');
    expect(migration).toContain('FROM public.fulfillment_orders o');
    expect(migration).toContain('FROM eligible');
    expect(migration).toContain("'kpis',(SELECT data FROM kpis)");
    expect(migration).toContain(" - 'raw_payload'");
  });
  it('status endpoint uses one aggregate RPC rather than four exact HEAD counts',()=>{
    const source=readFileSync('supabase/functions/amazon-status/index.ts','utf8');
    expect(source).toContain("admin.rpc('amazon_sync_job_counts'");
    expect(source).not.toContain("count:'exact',head:true");
  });
});
