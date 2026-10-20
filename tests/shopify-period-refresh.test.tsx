import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({read:vi.fn(),tenant:'one'}));
vi.mock('../src/services/shopifyAnalytics',()=>({loadShopifySummaryBatch:mocks.read}));
vi.mock('../src/services/supabase',()=>({getActiveTenant:()=>({workspace_id:mocks.tenant})}));
import {ShopifyPeriodCards} from '../src/components/shopify/ShopifyPeriodCards';
afterEach(()=>{cleanup();mocks.tenant='one';vi.clearAllMocks();});
const summary={grossSales:123,orders:1,units:1,refundCount:0,refundGross:0,profitComplete:false,netSales:100};
it('retains same-query figures during refresh and errors, clears them for new filters and tenant',async()=>{
 mocks.read.mockImplementation(async(periods:any[])=>periods.map(p=>({id:p.id,data:summary})));
 const props={filters:{from:'2026-10-20',to:'2026-10-20',storeIds:[] as string[]},calendarDay:'2026-10-20',refreshToken:0,onChange:vi.fn()};
 const view=render(<ShopifyPeriodCards {...props}/>);await waitFor(()=>expect(screen.getAllByText(/123,00/).length).toBeGreaterThan(0));
 let reject!:(error:Error)=>void;mocks.read.mockImplementation(()=>new Promise((_resolve,no)=>{reject=no}));
 view.rerender(<ShopifyPeriodCards {...props} refreshToken={1}/>);expect(screen.getAllByText(/123,00/).length).toBeGreaterThan(0);expect(screen.queryByText('Cargando periodo…')).toBeNull();
 await act(async()=>reject(new Error('Temporal')));expect(screen.getAllByText(/123,00/).length).toBeGreaterThan(0);
 view.rerender(<ShopifyPeriodCards {...props} filters={{...props.filters,storeIds:['other']}} refreshToken={2}/>);expect(screen.queryByText(/123,00/)).toBeNull();
 mocks.tenant='two';view.rerender(<ShopifyPeriodCards {...props} refreshToken={3}/>);expect(screen.queryByText(/123,00/)).toBeNull();
});
