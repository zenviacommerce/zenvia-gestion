import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {writeFile,unlink} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import React from 'react';

const summary={grossSales:1210,salesVat:210,netSales:1000,orders:20,businessOrders:0,units:25,amazonFees:100,amazonFeeVat:21,refunds:50,adsCost:60,amazonAdjustments:10,productCost:200,fbmShippingCost:30,netProfit:570,marginPct:57,profitComplete:false,unmappedSkuCount:1,unmappedUnits:2,missingHistoricalCostCount:0,missingHistoricalCostUnits:0,missingFxEventCount:0,missingVatOrderCount:0,missingFbmShippingCostCount:0,syncQueued:0,syncRunning:0,syncFailed:0,adsExcluded:false};
const stub=code=>({contents:code,loader:'js'});
const bundle=new URL('./.amazon-dashboard-ui.bundle.mjs',import.meta.url);
const result=await build({stdin:{contents:"export {AmazonSummary} from './src/components/amazon/AmazonSummary'; export {AmazonFilters} from './src/components/amazon/AmazonFilters'; export {AmazonProducts as ActualAmazonProducts} from './src/components/amazon/AmazonProducts';",resolveDir:new URL('../',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','lucide-react','react-dom','react-dom/*'],plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'fixture-css'}));
 b.onLoad({filter:/.*/,namespace:'fixture-css'},()=>({contents:'export default {};',loader:'js'}));
 b.onResolve({filter:/services\/amazon$/},()=>({path:'amazon',namespace:'fixture'}));
 b.onResolve({filter:/context\/SettingsContext$/},()=>({path:'settings',namespace:'fixture'}));
 b.onResolve({filter:/\.\/AmazonProducts$/},()=>({path:'products',namespace:'fixture'}));
 b.onResolve({filter:/\.\/AmazonMappingModal$/},()=>({path:'mapping',namespace:'fixture'}));
 b.onResolve({filter:/^recharts$/},()=>({path:'chart',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>{
  if(path==='amazon')return stub(`export const loadAmazonSummary=(f)=>globalThis.__amazonUi.summary(f);export const loadAmazonProducts=async()=>({items:[{sellerSku:'SKU-SIN-IMAGEN',asin:'ASIN-SIN-IMAGEN',units:4,orders:4,grossSales:121,netSales:100,profitBeforeAds:40,profitComplete:false}],page:1,pageSize:50,total:1});export const loadAmazonProductMetadata=async()=>({});export const loadAmazonDetail=async()=>({refundTransactions:2,refundOrders:2,refundGrossImpact:50});export const loadAmazonSeries=async()=>[{period:'2026-10-01',netSales:1000,netProfit:570}];export const isAmazonConnectivityError=()=>false;export const amazonQuickRange=(key)=>globalThis.__amazonUi.range(key);`);
  if(path==='settings')return stub(`export const useSettings=()=>({settings:{amazon:{consolidatedCurrency:'EUR'}}});`);
  if(path==='mapping')return stub(`export const AmazonMappingModal=()=>null;`);
  if(path==='products')return stub(`import React from 'react';export const AmazonProducts=({filters})=>React.createElement('section',{'aria-label':'Productos','data-from':filters.from,'data-to':filters.to},'Rentabilidad por producto');`);
  return stub(`import React from 'react';export const ResponsiveContainer=({children})=>children;export const LineChart=({children})=>React.createElement('div',null,children);export const Line=({dataKey})=>React.createElement('span',{'data-chart-metric':dataKey});export const CartesianGrid=()=>null;export const Legend=()=>null;export const XAxis=()=>null;export const YAxis=()=>null;export const Tooltip=()=>null;`);
 });
}}]});
await writeFile(bundle,result.outputFiles[0].text);
const {AmazonSummary,ActualAmazonProducts,AmazonFilters}=await import(bundle.href);
await unlink(bundle);
async function setup(failSummary=false,initialFilters={from:'2026-10-01',to:'2026-10-14',marketplaceIds:['ES']}){
 const w=new Window({url:'https://dashboard.test/'});
 for(const name of ['window','document','HTMLElement','Element','Node','Event'])globalThis[name]=name==='window'?w:name==='document'?w.document:w[name];
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 globalThis.requestAnimationFrame=callback=>{queueMicrotask(()=>callback(0));return 0};
 globalThis.cancelAnimationFrame=()=>{};
 const calls=[];
 globalThis.__amazonUi={summary:async filters=>{calls.push(filters);if(failSummary)throw new Error('Servicio no disponible');return {...summary}},range:()=>({from:'2026-10-01',to:'2026-10-14'})};
 if(failSummary)w.sessionStorage.setItem('zenvia-view-cache:amazon:summary:'+JSON.stringify({from:'2026-10-01',marketplaceIds:['ES'],to:'2026-10-14'}),JSON.stringify({value:summary}));
 const container=w.document.createElement('div');w.document.body.append(container);
 const root=createRoot(container);const selected=[];
 function Harness(){const [filters,setFilters]=React.useState(initialFilters);return React.createElement(AmazonSummary,{filters,onPeriodChange:f=>{selected.push(f);setFilters(f)}});}
 await act(async()=>{root.render(React.createElement(Harness));});
 return {w,root,container,calls,selected,close:async()=>{await act(async()=>root.unmount());await w.happyDOM.close()}};
}
test('period shortcuts retain marketplaces and profit remains marked provisional',async()=>{
 const s=await setup();
 assert.ok(s.container.querySelectorAll('.amazonPeriodCard').length>=4);
 assert.ok(s.container.querySelector('.amazonPeriodCarousel'));
 assert.equal(s.container.querySelectorAll('.amazonProfitKpis,.amazonSecondaryKpis').length,0);
 assert.match(s.container.querySelector('.amazonPeriodCard.isSelected').textContent,/570,00[\s\S]*Provisional/);
 const today=s.container.querySelector('.amazonPeriodCard button');
 await act(async()=>today.click());
 assert.deepEqual(s.selected[0].marketplaceIds,['ES']);
 assert.equal(s.selected[0].from,s.selected[0].to);
 assert.equal(s.container.querySelector('[aria-label="Productos"]').dataset.from,s.selected[0].from);
 assert.equal(s.container.querySelector('[aria-label="Productos"]').dataset.to,s.selected[0].to);
 assert.ok(s.container.querySelector('.amazonPeriodCard.isSelected').textContent.includes('Hoy'));
 assert.ok(s.calls.every(f=>f.marketplaceIds[0]==='ES'));
 await s.close();
});
test('chart metric selection lazily loads its series and retains one metric',async()=>{
 const s=await setup();
 assert.equal(s.container.querySelectorAll('[data-chart-metric]').length,0);
 await act(async()=>{const details=s.container.querySelector('.amazonDashboardDetails');details.open=true;details.dispatchEvent(new s.w.Event('toggle'));});
 assert.deepEqual([...s.container.querySelectorAll('[data-chart-metric]')].map(e=>e.dataset.chartMetric),['netSales','netProfit']);
 const inputs=s.container.querySelectorAll('.amazonChartOptions input');
 await act(async()=>inputs[2].click());
 assert.ok(s.container.querySelector('[data-chart-metric="adsCost"]'));
 await act(async()=>{inputs[0].click();});
 await act(async()=>{inputs[1].click();});
 assert.equal(inputs[2].disabled,true);
 assert.equal(s.container.querySelectorAll('[data-chart-metric]').length,1);
 await s.close();
});
test('the visible profit statement shows signed costs and matches the selected profit',async()=>{
 const s=await setup();
 assert.match(s.container.querySelector('.amazonProfitBridge').textContent,/-100,00/);
 assert.match(s.container.querySelector('.amazonProfitBridgeRow.is-total').textContent,/570,00/);
 assert.match(s.container.querySelector('.amazonStatementNote').textContent,/21,00.*no se resta de nuevo/);
 await s.close();
});

test('a failed refresh keeps cached primary figures without a permanent comparison spinner',async()=>{
 const s=await setup(true);
 assert.match(s.container.querySelector('.amazonPeriodCard.isSelected').textContent,/570,00/);
 assert.doesNotMatch(s.container.textContent,/Comparando/);
 await s.close();
});

test('each tile opens its own details without changing the product period',async()=>{
 const s=await setup();
 const card=s.container.querySelector('.amazonPeriodCard');
 assert.ok(card.querySelector('[data-metric="productCost"]'));
 const more=card.querySelector('.amazonPeriodMore');
 assert.equal(more.getAttribute('aria-expanded'),'false');
 await act(async()=>more.click());
 assert.equal(more.getAttribute('aria-expanded'),'true');
 assert.match(card.querySelector('.amazonPeriodExtra').textContent,/Tarifas Amazon sin IVA/);
 assert.equal(s.selected.length,0);
 await s.close();
});

test('embedded products retain the complete columns, identity and mapping actions',async()=>{
 const s=await setup();
 await act(async()=>{s.root.render(React.createElement(ActualAmazonProducts,{filters:{from:'2026-10-01',to:'2026-10-14',marketplaceIds:['ES']},embedded:true}));});
 assert.equal(s.container.querySelectorAll('thead th').length,14);
 assert.match(s.container.querySelector('.amazonSkuCell').textContent,/SKU-SIN-IMAGEN/);
 assert.equal(s.container.querySelectorAll('tbody tr:first-child td').length,14);
 assert.ok(s.container.querySelector('tbody .amazonInlineAction'));
 await s.close();
});

test('each tile shows refund amount and the actual number of refund transactions',async()=>{
 const s=await setup();
 for(const tile of s.container.querySelectorAll('.amazonPeriodCard:not([data-period-id="forecast"])')){
  assert.match(tile.querySelector('[data-metric="refunds"]').textContent,/50,00/);
  assert.match(tile.querySelector('.amazonRefundCount').textContent,/2 reembolsos/);
 }
 await s.close();
});
test('editing a tile date accepts a three-day range and filters products with that range',async()=>{
 const s=await setup();
 const date=s.container.querySelector('.amazonTileDate');
 await act(async()=>date.click());
 const dialog=s.container.querySelector('[role="dialog"][aria-label="Personalizar periodo"]');
 assert.ok(dialog);
 const from=dialog.querySelector('[name="from"]'),to=dialog.querySelector('[name="to"]');
 await act(async()=>{
  const setter=Object.getOwnPropertyDescriptor(s.w.HTMLInputElement.prototype,'value').set;
  setter.call(from,'2026-10-12');from.dispatchEvent(new s.w.Event('input',{bubbles:true}));from.dispatchEvent(new s.w.Event('change',{bubbles:true}));
  setter.call(to,'2026-10-14');to.dispatchEvent(new s.w.Event('input',{bubbles:true}));to.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 });
 await act(async()=>dialog.dispatchEvent(new s.w.Event('submit',{bubbles:true,cancelable:true})));
 assert.deepEqual(s.selected.at(-1),{from:'2026-10-12',to:'2026-10-14',marketplaceIds:['ES']});
 assert.equal(s.container.querySelector('[aria-label="Productos"]').dataset.from,'2026-10-12');
 assert.equal(s.container.querySelector('.amazonPeriodCard.isSelected h3').textContent,'Personalizado');
 await s.close();
});

test('desktop period and marketplace dropdowns preserve each other when filtering',async()=>{
 const s=await setup();const changes=[];
 globalThis.__amazonUi.range=key=>key==='yesterday'?{from:'2026-10-13',to:'2026-10-13'}:{from:'2026-10-14',to:'2026-10-14'};
 function FilterHarness(){const [filters,setFilters]=React.useState({from:'2026-10-14',to:'2026-10-14',marketplaceIds:[]});return React.createElement(AmazonFilters,{filters,marketplaces:[{id:'ES',name:'España',countryCode:'ES',active:true},{id:'FR',name:'Francia',countryCode:'FR',active:true}],onChange:f=>{changes.push(f);setFilters(f)}});}
 await act(async()=>s.root.render(React.createElement(FilterHarness)));
 assert.equal(s.container.querySelectorAll('.amazonDesktopFilters>details').length,2);
 const country=s.container.querySelector('.amazonDropdownMarketplaces input');
 await act(async()=>country.click());
 assert.deepEqual(changes.at(-1).marketplaceIds,['ES']);
 const period=s.container.querySelector('[role="combobox"][aria-label="Periodo de Amazon"]');
 await act(async()=>period.click());
 const yesterday=[...s.w.document.querySelectorAll('[role="option"]')].find(option=>option.textContent==='Ayer');
 assert.ok(yesterday);await act(async()=>yesterday.click());
 assert.deepEqual(changes.at(-1),{from:'2026-10-13',to:'2026-10-13',marketplaceIds:['ES']});
 await s.close();
});

test('forecast is a distinct estimate and selecting it shows actual month products',async()=>{
 const s=await setup();const card=s.container.querySelector('[data-period-id="forecast"]');
 assert.ok(card);assert.match(card.textContent,/Estimación/);assert.match(card.textContent,/días completos/);
 assert.equal(card.querySelector('button.amazonTileDate'),null);
 await act(async()=>card.querySelector('.amazonPeriodSelect').click());
 assert.equal(s.selected.at(-1).from,'2026-10-01');assert.equal(s.selected.at(-1).to,'2026-10-14');
 await s.close();
});

test('a selected full month keeps an actual-data tile alongside the forecast',async()=>{
 const s=await setup(false,{from:'2026-10-01',to:'2026-10-31',marketplaceIds:['ES']});
 const selected=s.container.querySelector('.amazonPeriodCard.isSelected');
 assert.ok(selected);assert.equal(selected.dataset.periodId,'selected');assert.match(selected.textContent,/1210,00/);
 assert.ok(s.container.querySelector('[data-period-id="forecast"]'));await s.close();
});
