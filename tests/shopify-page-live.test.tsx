import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({status:vi.fn(),batch:vi.fn(),products:vi.fn(),invalidate:vi.fn(),sync:vi.fn(),events:[] as Array<()=>void>}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:{general:{timezone:'Europe/Madrid'}},preferences:{pageSize:25}})}));
vi.mock('../src/services/supabase',()=>({getActiveTenant:()=>({workspace_id:'one'}),getActiveSupabase:()=>client}));
const client={channel:()=>({on:function(_type:unknown,_filter:unknown,callback:()=>void){mocks.events.push(callback);return this},subscribe:function(){return this}}),removeChannel:vi.fn()};
vi.mock('../src/services/shopifyAnalytics',()=>({loadShopifyStatus:mocks.status,loadShopifySummaryBatch:mocks.batch,loadShopifyProducts:mocks.products,invalidateShopifyAnalytics:mocks.invalidate,syncShopifyAnalytics:mocks.sync}));
import {ShopifyPage} from '../src/pages/Shopify';
afterEach(()=>{cleanup();vi.clearAllMocks();mocks.events=[];});
it('updates mounted cards and products after ingestion without manual sync and retains search during silent errors',async()=>{
 const status={connected:true,stores:[{id:'store',name:'Store',lastSyncedAt:'2026-10-20',availableFrom:null}]};let sales=123;
 mocks.status.mockResolvedValue(status);mocks.batch.mockImplementation(async(periods:any[])=>periods.map(p=>({id:p.id,data:{grossSales:sales,orders:1,units:1,refundCount:0,refundGross:0,profitComplete:false,netSales:sales}})));
 mocks.products.mockImplementation(async()=>({items:[{id:'p',storeId:'store',storeName:'Store',sku:'SKU',name:'Product',units:1,orders:1,grossSales:sales,netSales:sales,profitComplete:false}],total:1}));
 render(<ShopifyPage isAdmin/>);await screen.findByText('Product');expect(screen.getAllByText(/123,00/).length).toBeGreaterThan(1);
 fireEvent.change(screen.getByLabelText('Buscar productos Shopify'),{target:{value:'SKU'}});await waitFor(()=>expect(mocks.products).toHaveBeenLastCalledWith(expect.anything(),'SKU',1,25,'product_name','asc',false));
 sales=456;act(()=>mocks.events[1]());await waitFor(()=>expect(screen.getAllByText(/456,00/).length).toBeGreaterThan(1));expect((screen.getByLabelText('Buscar productos Shopify') as HTMLInputElement).value).toBe('SKU');expect(mocks.sync).not.toHaveBeenCalled();expect(mocks.invalidate).toHaveBeenCalled();
 mocks.status.mockRejectedValue(new Error('temporary'));act(()=>window.dispatchEvent(new Event('zenvia:orders-refresh')));await waitFor(()=>expect(mocks.status).toHaveBeenCalledTimes(3));expect(screen.getByText('Product')).toBeTruthy();expect(screen.queryByText('Cargando tiendas Shopify…')).toBeNull();expect((screen.getByLabelText('Buscar productos Shopify') as HTMLInputElement).value).toBe('SKU');
});
