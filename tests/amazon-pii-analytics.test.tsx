import {render,screen,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DEFAULT_APP_SETTINGS} from '../src/services/settingsSchema';
import {AmazonOrders} from '../src/components/amazon/AmazonOrders';
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:DEFAULT_APP_SETTINGS})}));
// Only the network boundary is substituted; table, sorting and money formatting are real.
vi.mock('../src/services/amazon',async original=>({...await original<typeof import('../src/services/amazon')>(),loadAmazonOrders:async()=>({items:[{amazonOrderId:'SYNTHETIC-ANALYTICS',purchaseDate:'2026-07-01',marketplaceId:'A1RKKUPIHCS9HS',status:'Shipped',units:2,netSales:24,amazonFees:3,productCost:5,profitBeforeAds:16,profitComplete:true}],total:1,page:1,pageSize:25})}));
afterEach(cleanup);
it('renders Amazon financial listing from retained facts with no buyer fields',async()=>{render(<AmazonOrders filters={{from:'2026-07-01',to:'2026-07-31',marketplaceIds:[]}} marketplaces={[]}/>);await waitFor(()=>expect(screen.getByText('SYNTHETIC-ANALYTICS')).toBeTruthy());expect(screen.getByText('24,00 €')).toBeTruthy();expect(screen.getByText('16,00 €')).toBeTruthy();expect(screen.getByText('1 pedidos')).toBeTruthy();});
