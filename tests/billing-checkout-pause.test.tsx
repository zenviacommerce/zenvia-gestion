import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SettingsPage} from '../src/pages/Settings';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
const state=vi.hoisted(()=>({checkout:vi.fn(),verified:false}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:DEFAULT_APP_SETTINGS,preferences:DEFAULT_USER_PREFERENCES,warnings:[],error:null,loading:false,updateSection:async()=>{}})}));
vi.mock('../src/services/billing',async original=>({...await original<any>(),
 loadCustomerBillingOverview:async()=>({currentPlan:{planKey:'internal',name:'Interno',description:'',monthlyPriceCents:null,yearlyPriceCents:null,entitlements:[]},subscription:{planKey:'internal',status:'active',billingProvider:'manual'},usage:{users:{value:1,limit:null},amazonAccounts:{value:1,limit:null},monthlyOrders:{value:0,limit:null}},availablePlans:[{planKey:'pro',name:'Pro',description:'Plan Pro',monthlyPriceCents:3999,yearlyPriceCents:39999,isPublic:true,entitlements:[],commercialVersion:2,paypalMode:'sandbox',checkout:state.verified?{monthly:{ok:true,paypalPlanId:'P-M',checkedAt:new Date().toISOString()},yearly:{ok:false,paypalPlanId:'P-Y',checkedAt:new Date().toISOString()}}:undefined}]}),
 loadCustomerSubscriptionInvoices:async()=>[],startCustomerPayPalCheckout:state.checkout,
}));
vi.mock('../src/services/sales',async original=>({...await original<any>(),loadBusinessSettings:async()=>({legalName:'Prueba',countryCode:'ES'})}));
vi.mock('../src/services/companyBranding',async original=>({...await original<any>(),loadCompanyBranding:async()=>({logoPath:null,logoDataUrl:null})}));
afterEach(cleanup);
it('keeps monthly and yearly plans visible while blocking checkout and explaining the pause',async()=>{
 render(<SettingsPage isAdmin access={{workspaceId:'test',planKey:'internal',entitlements:{}} as any}/>);
 fireEvent.click(screen.getByRole('tab',{name:/Plan y facturación/}));
 expect(await screen.findByText('Estamos actualizando los precios; la contratación estará disponible en breve')).toBeTruthy();
 const button=screen.getByRole('button',{name:'Contratar con PayPal'}) as HTMLButtonElement;
 expect(button.disabled).toBe(true);expect(screen.getByText('39,99 €')).toBeTruthy();
 fireEvent.click(button);expect(state.checkout).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Anual',exact:true}));
 expect(screen.getByText('399,99 €')).toBeTruthy();expect((screen.getByRole('button',{name:'Contratar con PayPal'}) as HTMLButtonElement).disabled).toBe(true);
});
it('shows the base price + IVA and commercial revision, enabling only the verified cycle',async()=>{
 state.verified=true;try{
 render(<SettingsPage isAdmin access={{workspaceId:'test',planKey:'internal',entitlements:{}} as any}/>);
 fireEvent.click(screen.getByRole('tab',{name:/Plan y facturación/}));
 expect(await screen.findByText('Versión comercial 2')).toBeTruthy();expect(screen.getByText('+ IVA')).toBeTruthy();
 expect((screen.getByRole('button',{name:'Contratar con PayPal'}) as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Anual',exact:true}));
 expect((screen.getByRole('button',{name:'Contratar con PayPal'}) as HTMLButtonElement).disabled).toBe(true);
 }finally{state.verified=false}
});
