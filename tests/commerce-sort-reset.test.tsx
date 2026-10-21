import {cleanup,fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {AmazonProducts} from '../src/components/amazon/AmazonProducts';
import {AmazonOrders} from '../src/components/amazon/AmazonOrders';
import {AmazonInventory} from '../src/components/amazon/AmazonInventory';
import {AmazonUnmapped} from '../src/components/amazon/AmazonUnmapped';
import {ShopifyProducts} from '../src/components/shopify/ShopifyProducts';
const mocks=vi.hoisted(()=>({amazon:vi.fn(),shopify:vi.fn(),orders:vi.fn(),inventory:vi.fn(),unmapped:vi.fn()}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:{amazon:{consolidatedCurrency:'EUR'}},preferences:{pageSize:25}})}));
vi.mock('../src/services/amazon',()=>({loadAmazonOrders:mocks.orders,loadAmazonInventory:mocks.inventory,loadAmazonUnmapped:mocks.unmapped,loadAmazonProductImages:async()=>({}),loadAmazonProducts:mocks.amazon,loadAmazonProductMetadata:async()=>({}),isAmazonConnectivityError:()=>false}));
vi.mock('../src/services/shopifyAnalytics',()=>({loadShopifyProducts:mocks.shopify}));
vi.mock('../src/services/viewCache',()=>({readViewCache:()=>null,writeViewCache:()=>{},stableCacheKey:(_n:string,p:unknown)=>JSON.stringify(p)}));
vi.mock('../src/components/amazon/AmazonMappingModal',()=>({AmazonMappingModal:()=>null}));
vi.mock('../src/components/shopify/ShopifyMappingModal',()=>({ShopifyMappingModal:()=>null}));
const filters={from:'2026-10-01',to:'2026-10-21',marketplaceIds:[],storeIds:[]};
afterEach(()=>{cleanup();vi.resetAllMocks()});
it('Amazon sends the three sort states to the server and returns from page two to page one',async()=>{
 mocks.amazon.mockResolvedValue({items:[],total:50,page:1,pageSize:25});render(<AmazonProducts filters={filters}/>);
 await waitFor(()=>expect(mocks.amazon).toHaveBeenLastCalledWith(filters,'',1,25,'profit_before_ads','desc'));
 fireEvent.click(screen.getByRole('button',{name:'Siguiente'}));await waitFor(()=>expect(mocks.amazon).toHaveBeenLastCalledWith(filters,'',2,25,'profit_before_ads','desc'));
 fireEvent.click(screen.getByRole('button',{name:'Ventas',exact:true}));await waitFor(()=>expect(mocks.amazon).toHaveBeenLastCalledWith(filters,'',1,25,'gross_sales','asc'));
 fireEvent.click(screen.getByRole('button',{name:'Ventas',exact:true}));await waitFor(()=>expect(mocks.amazon).toHaveBeenLastCalledWith(filters,'',1,25,'gross_sales','desc'));
 fireEvent.click(screen.getByRole('button',{name:'Ventas',exact:true}));await waitFor(()=>expect(mocks.amazon).toHaveBeenLastCalledWith(filters,'',1,25,'profit_before_ads','desc'));
 expect(screen.queryByRole('button',{name:'Restablecer orden'})).toBeNull();
});
it('Shopify sends the default product-name ascending parameters again after a third click or reset',async()=>{
 mocks.shopify.mockResolvedValue({items:[],total:50});render(<ShopifyProducts filters={filters} refreshToken={0} onChanged={()=>{}} calendarDay="2026-10-21"/>);
 await waitFor(()=>expect(mocks.shopify).toHaveBeenLastCalledWith(filters,'',1,25,'product_name','asc',false));
 fireEvent.click(screen.getByRole('button',{name:'Siguiente'}));await waitFor(()=>expect(mocks.shopify).toHaveBeenLastCalledWith(filters,'',2,25,'product_name','asc',false));
 for(const dir of ['asc','desc']){fireEvent.click(screen.getByRole('button',{name:'Unidades',exact:true}));await waitFor(()=>expect(mocks.shopify).toHaveBeenLastCalledWith(filters,'',1,25,'units',dir,false));}
 fireEvent.click(screen.getByRole('button',{name:'Unidades',exact:true}));await waitFor(()=>expect(mocks.shopify).toHaveBeenLastCalledWith(filters,'',1,25,'product_name','asc',false));
 fireEvent.click(screen.getByRole('button',{name:'Unidades',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Restablecer orden'}));
 await waitFor(()=>expect(mocks.shopify).toHaveBeenLastCalledWith(filters,'',1,25,'product_name','asc',false));
});
it('an obsolete Amazon sorting response cannot overwrite a newer reset response',async()=>{
 let finishOld!:(value:any)=>void;
 mocks.amazon.mockImplementation((_f:any,_s:any,_p:any,_size:any,sort:string)=>sort==='gross_sales'?new Promise(resolve=>{finishOld=resolve}):Promise.resolve({items:[],total:50,page:1,pageSize:25}));
 render(<AmazonProducts filters={filters}/>);await screen.findByText('50 productos · 1–25');
 fireEvent.click(screen.getByRole('button',{name:'Ventas',exact:true}));await waitFor(()=>expect(finishOld).toBeTypeOf('function'));
 fireEvent.click(screen.getByRole('button',{name:'Restablecer orden'}));await screen.findByText('50 productos · 1–25');
 await act(async()=>finishOld({items:[],total:999,page:1,pageSize:25}));
 expect(screen.queryByText('999 productos · 1–25')).toBeNull();
});

for(const [name,Component,load,pageIndex,header] of [
 ['orders',AmazonOrders,mocks.orders,2,'Pedido'],
 ['inventory',AmazonInventory,mocks.inventory,2,'Disponible'],
 ['unmapped',AmazonUnmapped,mocks.unmapped,1,'Producto Amazon'],
] as const){
 it(name+': a late page-two response cannot overwrite page one after reset',async()=>{
  let finishOld!:(value:any)=>void;
  load.mockImplementation((...args:any[])=>args[pageIndex]===2?new Promise(resolve=>{finishOld=resolve}):Promise.resolve({items:[],total:50,page:1,pageSize:25}));
  render(<Component filters={filters} marketplaces={[]}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Siguiente'})).not.toHaveProperty('disabled',true));
  fireEvent.click(screen.getByRole('button',{name:header,exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Siguiente'}));
  await waitFor(()=>expect(finishOld).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button',{name:'Restablecer orden'}));
  await screen.findByText('Página 1');
  await act(async()=>finishOld({items:[],total:999,page:2,pageSize:25}));
  expect(screen.queryByText(/999/)).toBeNull();
  expect(screen.getByText('Página 1')).toBeTruthy();
 });
}
