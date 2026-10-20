import {expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('../src/services/supabase',()=>({supabase:{functions:{invoke:transport.invoke}}}));
import {testIntegrationAccount,deleteIntegrationAccount,disconnectIntegrationAccount,setDefaultIntegrationAccount,updateIntegrationAccount} from '../src/services/integrationAccounts';
import {ENTITY_CHANGED} from '../src/services/entityChanges';
it.each([testIntegrationAccount,deleteIntegrationAccount,disconnectIntegrationAccount,setDefaultIntegrationAccount])('publishes integration invalidation after %s succeeds, never before',async mutate=>{
 let finish:any;transport.invoke.mockImplementation(()=>new Promise(r=>finish=r));const listener=vi.fn();window.addEventListener(ENTITY_CHANGED,listener);
 try{const pending=mutate('account');expect(listener).not.toHaveBeenCalled();finish({data:{ok:true,accounts:[]},error:null});await pending;expect(listener).toHaveBeenCalledTimes(1);
 transport.invoke.mockResolvedValue({error:new Error('offline'),data:null});await expect(mutate('account')).rejects.toThrow();expect(listener).toHaveBeenCalledTimes(1);}finally{window.removeEventListener(ENTITY_CHANGED,listener)}
});
