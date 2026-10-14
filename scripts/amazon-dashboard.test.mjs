import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
async function helpers(){
 let source;try{source=await readFile(new URL('../src/services/amazonDashboard.ts',import.meta.url),'utf8')}catch{}
 assert.ok(source,'Dashboard needs calendar comparisons and signed cost breakdown');
 return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
}
test('calendar comparisons use the same elapsed days and clamp February',async()=>{
 const {amazonComparisonRange}=await helpers();
 assert.deepEqual(amazonComparisonRange({from:'2026-01-01',to:'2026-01-01',marketplaceIds:[]}),{from:'2025-12-31',to:'2025-12-31',marketplaceIds:[]});
 assert.deepEqual(amazonComparisonRange({from:'2026-10-01',to:'2026-10-14',marketplaceIds:['ES']}),{from:'2026-09-01',to:'2026-09-14',marketplaceIds:['ES']});
 assert.deepEqual(amazonComparisonRange({from:'2026-03-01',to:'2026-03-30',marketplaceIds:[]}),{from:'2026-02-01',to:'2026-02-28',marketplaceIds:[]});
 assert.deepEqual(amazonComparisonRange({from:'2026-10-05',to:'2026-10-11',marketplaceIds:[]}),{from:'2026-09-28',to:'2026-10-04',marketplaceIds:[]});
 assert.deepEqual(amazonComparisonRange({from:'2026-09-01',to:'2026-09-30',marketplaceIds:[]}),{from:'2026-08-01',to:'2026-08-31',marketplaceIds:[]});
});
test('period cards respect marketplaces and year boundaries',async()=>{
 const {amazonDashboardPeriods}=await helpers();
 const periods=amazonDashboardPeriods(new Date(2026,0,1,12),['ES']);
 assert.deepEqual(periods.map(p=>[p.id,p.filters.from,p.filters.to]),[['today','2026-01-01','2026-01-01'],['yesterday','2025-12-31','2025-12-31'],['current_month','2026-01-01','2026-01-01'],['forecast','2026-01-01','2026-01-31'],['previous_month','2025-12-01','2025-12-31']]);
 assert.ok(periods.every(p=>p.filters.marketplaceIds[0]==='ES'));
});
test('deltas handle zero, null and recovering from a loss without infinity',async()=>{
 const {amazonMetricChange}=await helpers();
 assert.equal(amazonMetricChange(150,100),50);
 assert.equal(amazonMetricChange(20,-100),120);
 assert.equal(amazonMetricChange(100,0),null);
 assert.equal(amazonMetricChange(null,100),null);
 assert.equal(amazonMetricChange(0,0),0);
});
test('profit bridge preserves signs, excludes recoverable fee VAT, and reconciles to reported profit',async()=>{
 const {amazonProfitBridge}=await helpers();
 const rows=amazonProfitBridge({grossSales:1210,salesVat:210,netSales:1000,amazonFees:100,amazonFeeVat:21,refunds:50,adsCost:60,amazonAdjustments:10,productCost:200,fbmShippingCost:30,netProfit:570});
 assert.equal(rows.filter(r=>r.kind==='movement').reduce((n,r)=>n+r.amount,0),570);
 assert.equal(rows.find(r=>r.key==='netProfit').amount,570);
 assert.equal(rows.find(r=>r.key==='amazonFees').amount,-100);
 assert.ok(!rows.some(r=>r.key==='amazonFeeVat'));
 assert.equal(amazonProfitBridge({grossSales:100,salesVat:0,netSales:100,amazonFees:-5,refunds:0,adsCost:0,amazonAdjustments:-10,productCost:0,fbmShippingCost:0,netProfit:95}).find(r=>r.key==='amazonFees').amount,5);
});

test('month forecast uses complete days, preserves unknown profit and rounds counts',async()=>{
 const {amazonMonthForecast}=await helpers();
 const month={grossSales:1400,netSales:1300,netProfit:140,orders:140,units:150,refunds:14,profitComplete:false};
 const today={grossSales:100,netSales:100,netProfit:10,orders:10,units:7,refunds:1};
 const forecast=amazonMonthForecast(month,today,new Date(2026,9,14));
 assert.equal(forecast.grossSales,3100);assert.equal(forecast.orders,310);assert.equal(forecast.units,341);assert.equal(forecast.refunds,31);assert.equal(forecast.profitComplete,false);
 assert.equal(amazonMonthForecast(month,today,new Date(2026,9,1)),null);
 assert.equal(amazonMonthForecast({...month,netProfit:null},today,new Date(2026,9,14)).netProfit,null);
 assert.equal(amazonMonthForecast(month,today,new Date(2028,1,14)).grossSales,2900);
});
