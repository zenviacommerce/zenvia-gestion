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
const result=await build({stdin:{contents:"export {AmazonSummary} from './src/components/amazon/AmazonSummary'; export {AmazonPeriodCards} from './src/components/amazon/AmazonPeriodCards'; export {AmazonFilters} from './src/components/amazon/AmazonFilters'; export {AmazonProducts as ActualAmazonProducts} from './src/components/amazon/AmazonProducts';",resolveDir:new URL('../',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','lucide-react','react-dom','react-dom/*'],plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'fixture-css'}));
 b.onLoad({filter:/.*/,namespace:'fixture-css'},()=>({contents:'export default {};',loader:'js'}));
 b.onResolve({filter:/services\/amazon$/},()=>({path:'amazon',namespace:'fixture'}));
 b.onResolve({filter:/context\/SettingsContext$/},()=>({path:'settings',namespace:'fixture'}));
 b.onResolve({filter:/\.\/AmazonProducts$/},()=>({path:'products',namespace:'fixture'}));
 b.onResolve({filter:/\.\/AmazonMappingModal$/},()=>({path:'mapping',namespace:'fixture'}));
 b.onResolve({filter:/^recharts$/},()=>({path:'chart',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>{
  if(path==='amazon')return stub(`export const loadAmazonSummary=(f)=>globalThis.__amazonUi.summary(f);export const loadAmazonProducts=async()=>({items:[{sellerSku:'SKU-SIN-IMAGEN',asin:'ASIN-SIN-IMAGEN',units:4,orders:4,grossSales:121,netSales:100,profitBeforeAds:40,profitComplete:false}],page:1,pageSize:50,total:1});export const loadAmazonProductMetadata=async()=>({});export const loadAmazonDetail=async f=>globalThis.__amazonUi.detail?globalThis.__amazonUi.detail(f):({refundTransactions:2,refundOrders:2,refundGrossImpact:50});export const loadAmazonSeries=async()=>[{period:'2026-10-01',netSales:1000,netProfit:570}];export const isAmazonConnectivityError=()=>false;export const amazonQuickRange=(key,now)=>globalThis.__amazonUi.range(key,now);`);
  if(path==='settings')return stub(`export const useSettings=()=>({settings:{amazon:{consolidatedCurrency:'EUR'}}});`);
  if(path==='mapping')return stub(`export const AmazonMappingModal=()=>null;`);
  if(path==='products')return stub(`import React from 'react';export const AmazonProducts=({filters})=>React.createElement('section',{'aria-label':'Productos','data-from':filters.from,'data-to':filters.to},'Rentabilidad por producto');`);
  return stub(`import React from 'react';export const ResponsiveContainer=({children})=>children;export const LineChart=({children})=>React.createElement('div',null,children);export const Line=({dataKey})=>React.createElement('span',{'data-chart-metric':dataKey});export const CartesianGrid=()=>null;export const Legend=()=>null;export const XAxis=()=>null;export const YAxis=()=>null;export const Tooltip=()=>null;`);
 });
}}]});
await writeFile(bundle,result.outputFiles[0].text);
const {AmazonSummary,AmazonPeriodCards,ActualAmazonProducts,AmazonFilters}=await import(bundle.href);
await unlink(bundle);
async function setup(failSummary=false,initialFilters={from:'2026-10-01',to:'2026-10-14',marketplaceIds:['ES']},summaryOverride={}){
 const w=new Window({url:'https://dashboard.test/'});
 for(const name of ['window','document','HTMLElement','Element','Node','Event'])globalThis[name]=name==='window'?w:name==='document'?w.document:w[name];
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 globalThis.requestAnimationFrame=callback=>{queueMicrotask(()=>callback(0));return 0};
 globalThis.cancelAnimationFrame=()=>{};
 const calls=[];
 globalThis.__amazonUi={summary:async filters=>{calls.push(filters);if(failSummary)throw new Error('Servicio no disponible');return {...summary,...summaryOverride}},range:()=>({from:'2026-10-01',to:'2026-10-14'})};
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
 assert.ok(s.container.querySelector('tbody .productMappingAction'));
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
 const madridDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const dayBeforeSetup=madridDay();
 const s=await setup();const card=s.container.querySelector('[data-period-id="forecast"]');
 assert.ok(card);assert.match(card.textContent,/Estimación/);assert.match(card.textContent,/días completos/);
 assert.equal(card.querySelector('button.amazonTileDate'),null);
 await act(async()=>card.querySelector('.amazonPeriodSelect').click());
 const dayAfterSetup=madridDay();
 const chosen=s.selected.at(-1);
 assert.ok([dayBeforeSetup,dayAfterSetup,new Date().toISOString().slice(0,10)].includes(chosen.to),'Forecast selection must use a date matching the local or UTC render clock');
 assert.equal(chosen.from,chosen.to.slice(0,7)+'-01');
 await s.close();
});

test('a selected full month keeps an actual-data tile alongside the forecast',async()=>{
 const s=await setup(false,{from:'2026-10-01',to:'2026-10-31',marketplaceIds:['ES']});
 const selected=s.container.querySelector('.amazonPeriodCard.isSelected');
 assert.ok(selected);assert.equal(selected.dataset.periodId,'selected');assert.match(selected.textContent,/1210,00/);
 assert.ok(s.container.querySelector('[data-period-id="forecast"]'));await s.close();
});

test('missing daily Ads is explicit and financial charges remain separately available',async()=>{
 const s=await setup();const tile=s.container.querySelector('.amazonPeriodCard.isSelected');
 assert.match(tile.textContent,/Publicidad diariaNo disponibleAmazon Ads sin conectar/);
 await act(async()=>tile.querySelector('.amazonPeriodMore').click());
 assert.match(tile.querySelector('.amazonPeriodExtra').textContent,/Cargos publicitarios contabilizados-60,00/);
 await s.close();
});

test('profit remains provisional when daily advertising is unavailable despite complete received costs',async()=>{
 const s=await setup(false,undefined,{profitComplete:true});
 assert.match(s.container.querySelector('.amazonPeriodCard.isSelected .amazonPeriodQuality').textContent,/Provisional/);
 await s.close();
});

test('a new business day reloads the actual month and today for its forecast',async()=>{
 const s=await setup();
 await act(async()=>s.root.render(React.createElement(AmazonSummary,{filters:{from:'2026-10-01',to:'2026-10-14',marketplaceIds:['ES']},calendarDay:'2026-10-15'})));
 assert.ok(s.calls.some(f=>f.from==='2026-10-01'&&f.to==='2026-10-15'));
 assert.ok(s.calls.some(f=>f.from==='2026-10-15'&&f.to==='2026-10-15'));
 assert.ok(!s.calls.some(f=>f.to==='2026-10-31'),'A forecast should never fetch future actual sales');
 await s.close();
});

test('Today dropdown uses the workspace calendar instead of the browser date',async()=>{
 const s=await setup();let dateUsed;
 globalThis.__amazonUi.range=(key,now)=>{dateUsed=now;return {from:'2026-10-15',to:'2026-10-15'};};
 await act(async()=>s.root.render(React.createElement(AmazonFilters,{calendarDay:'2026-10-15',filters:{from:'2026-10-15',to:'2026-10-15',marketplaceIds:[]},marketplaces:[],onChange:()=>{}})));
 assert.equal(dateUsed.getDate(),15);assert.equal(dateUsed.getMonth(),9);await s.close();
});

test('forecast reuses month and today ranges and summary rerenders retain loaded cards',async()=>{
 const s=await setup();const calls=[];globalThis.__amazonUi.summary=async filters=>{calls.push(filters);return {...summary};};
 const props={filters:{from:'2026-10-14',to:'2026-10-14',marketplaceIds:['ES']},summary,currency:'EUR',refreshToken:0,calendarDay:'2026-10-14'};
 await act(async()=>s.root.render(React.createElement(AmazonPeriodCards,props)));
 const monthCalls=()=>calls.filter(f=>f.from==='2026-10-01'&&f.to==='2026-10-14').length;
 assert.equal(monthCalls(),1,'Month card and forecast should share one range request');
 const loaded=s.container.querySelector('[data-period-id="previous_month"] .amazonPeriodSales strong').textContent;
 await act(async()=>s.root.render(React.createElement(AmazonPeriodCards,{...props,summary:{...summary,orders:21}})));
 assert.equal(monthCalls(),1,'A new selected summary object must not restart loaded month scans');
 assert.equal(s.container.querySelector('[data-period-id="previous_month"] .amazonPeriodSales strong').textContent,loaded);
 await s.close();
});

test('products mount while a primary monthly summary is pending and remain mounted when it completes',async()=>{
 const s=await setup();let resolve;const filters={from:'2030-01-01',to:'2030-01-14',marketplaceIds:['ES']};
 globalThis.__amazonUi.summary=async range=>range.from===filters.from&&range.to===filters.to?new Promise(r=>resolve=r):summary;
 await act(async()=>s.root.render(React.createElement(AmazonSummary,{filters,calendarDay:'2030-01-14'})));
 const products=s.container.querySelector('[aria-label="Productos"]');assert.ok(products,'Products must not wait for a slow monthly summary');
 assert.match(s.container.textContent,/Cargando resumen/);
 await act(async()=>resolve(summary));
 assert.equal(s.container.querySelector('[aria-label="Productos"]'),products,'Completed primary data must not remount Products');
 await s.close();
});
test('fast summary refund metadata keeps visible refund counts without any detail scans',async()=>{
 const s=await setup();let detailCalls=0;globalThis.__amazonUi.detail=async()=>{detailCalls++;return {refundTransactions:2,refundGrossImpact:50}};
 globalThis.__amazonUi.summary=async()=>({...summary,refundTransactions:3,refundGrossImpact:75});
 const fastSummary={...summary,refundTransactions:3,refundGrossImpact:75};
 await act(async()=>s.root.render(React.createElement(AmazonPeriodCards,{filters:{from:'2026-10-14',to:'2026-10-14',marketplaceIds:['ES']},summary:fastSummary,currency:'EUR',refreshToken:0,calendarDay:'2026-10-14'})));
 assert.equal(detailCalls,0);
 for(const card of s.container.querySelectorAll('.amazonPeriodCard:not([data-period-id="forecast"])'))assert.match(card.querySelector('.amazonRefundCount').textContent,/3 reembolsos/);
 await s.close();
});
test('revealing forecast retains pending month work and completed previous month values',async()=>{
 const s=await setup();const observers=[];globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;observers.push(this)}observe(){}disconnect(){}};
 const calls=[];let finishMonth;globalThis.__amazonUi.summary=async filters=>{calls.push(filters);return filters.from==='2026-10-01'&&filters.to==='2026-10-14'?new Promise(resolve=>finishMonth=resolve):summary};
 const props={filters:{from:'2026-10-14',to:'2026-10-14',marketplaceIds:['ES']},summary,currency:'EUR',refreshToken:0,calendarDay:'2026-10-14'};
 try{
  await act(async()=>s.root.render(React.createElement(AmazonPeriodCards,props)));
  const observer=observers.at(-1),month=s.container.querySelector('[data-period-id="current_month"]'),previous=s.container.querySelector('[data-period-id="previous_month"]'),forecast=s.container.querySelector('[data-period-id="forecast"]');
  await act(async()=>observer.callback([{isIntersecting:true,target:month},{isIntersecting:true,target:previous}]));
  const previousValue=previous.querySelector('.amazonPeriodSales strong').textContent;assert.notEqual(previousValue,'—');
  await act(async()=>observer.callback([{isIntersecting:true,target:forecast}]));
  assert.equal(calls.filter(f=>f.from==='2026-10-01'&&f.to==='2026-10-14').length,1);
  assert.equal(previous.querySelector('.amazonPeriodSales strong').textContent,previousValue);
  await act(async()=>finishMonth(summary));
  assert.notEqual(forecast.querySelector('.amazonPeriodSales strong').textContent,'—');
 }finally{delete globalThis.IntersectionObserver;await s.close();}
});
test('a failed forecast base shows a retryable error instead of an endless loading label',async()=>{
 const s=await setup();globalThis.__amazonUi.summary=async filters=>{if(filters.from==='2026-10-01'&&filters.to==='2026-10-14')throw new Error('Monthly query unavailable');return summary;};
 await act(async()=>s.root.render(React.createElement(AmazonPeriodCards,{filters:{from:'2026-10-14',to:'2026-10-14',marketplaceIds:['ES']},summary,currency:'EUR',refreshToken:0,calendarDay:'2026-10-14'})));
 const forecast=s.container.querySelector('[data-period-id="forecast"]');assert.match(forecast.querySelector('.amazonPeriodQuality').textContent,/Error/);assert.doesNotMatch(forecast.textContent,/Cargando base/);assert.ok(forecast.querySelector('[aria-label="Reintentar Mes actual (pronóstico)"]'));
 await s.close();
});

test('summary shows cards and products without the removed graph and breakdown',async()=>{
 const s=await setup();
 assert.ok(s.container.querySelector('.amazonPeriodCarousel'));
 assert.ok(s.container.querySelector('[aria-label="Productos"]'));
 assert.equal(s.container.querySelector('.amazonDashboardDetails,.amazonProfitStatement,.amazonChartCard'),null);
 await s.close();
});
