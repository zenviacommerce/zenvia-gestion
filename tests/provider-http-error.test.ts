import {it,expect,vi} from 'vitest';
const api=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock('../src/services/supabase',()=>({supabase:{functions:{invoke:api.invoke}},getActiveSupabase:()=>({})}));
import {getShippingOptions} from '../src/services/orders';
it('keeps HTTP 503 retryable when the Edge error body does not contain the status code',async()=>{
 api.invoke.mockResolvedValue({data:null,error:{message:'FunctionsHttpError',context:new Response(JSON.stringify({error:'Bad gateway'}),{status:503})}});
 const result=await getShippingOptions('synthetic-order',undefined,['envia']);expect(result.providers.envia).toMatchObject({state:'error',message:'Bad gateway',retryable:true});
});
