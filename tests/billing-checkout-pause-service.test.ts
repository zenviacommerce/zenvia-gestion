import {expect,it,vi} from 'vitest';
import {startCustomerPayPalCheckout} from '../src/services/billing';
vi.mock('../src/services/supabase',()=>({supabase:{auth:{getSession:vi.fn(()=>{throw new Error('Unexpected auth access')})}}}));
it.each(['monthly','yearly'] as const)('rejects a direct %s checkout call before any network or session access',async cycle=>{
 const network=vi.spyOn(globalThis,'fetch');
 await expect(startCustomerPayPalCheckout({access:{workspaceId:'test'} as any,targetPlan:{planKey:'pro',isPublic:true,monthlyPriceCents:3999,yearlyPriceCents:39999} as any,cycle})).rejects.toThrow('Estamos actualizando los precios');
 expect(network).not.toHaveBeenCalled();
});
