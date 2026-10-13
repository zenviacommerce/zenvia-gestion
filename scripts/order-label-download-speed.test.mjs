import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
test('label PDF is delivered before refreshing the order list',async()=>{
 const source=fs.readFileSync(new URL('../src/pages/Orders.tsx',import.meta.url),'utf8');const body=source.slice(source.indexOf('  const createLabel=async'),source.indexOf('  const existingLabel=async')).replace('const createLabel=','globalThis.createLabel=');
 const events=[];let resolveRefresh;const refresh=new Promise(resolve=>{resolveRefresh=resolve});
 const order={id:'order',orderNumber:'1003'};const context=vm.createContext({settings:{orders:{pushTrackingToMarketplace:true,downloadLabelAfterCreation:true},shipping:{autoDownload:true}},labelOrder:order,labelFilenameOptions:{},validationCarrier:()=>'',validateOrderForCarrier:()=>({blocking:false,issues:[]}),setBusyOrder:()=>{},setLabelOrder:()=>{},setEditValidationCarrier:()=>{},setEditOrder:()=>{},createOrderLabel:async(_id,_option,_push,onReady)=>{const result={base64:'pdf'};await onReady?.(result);return result},labelBlob:()=>new Blob(['pdf']),prepareLabelPdf:async blob=>blob,downloadLabel:()=>events.push('download'),labelPdfFilename:()=> '1003.pdf',listFulfillmentOrders:()=>{events.push('refresh');return refresh},markOrderLabelPrinted:async()=>events.push('printed'),setOrders:()=>{},setSelected:()=>{},showSuccess:()=>{},showInfo:()=>{},showError:e=>{throw Error(e)},errorMessage:e=>String(e)});
 vm.runInContext(ts.transpile(body),context);const pending=context.createLabel(null);for(let i=0;i<10;i++)await Promise.resolve();
 try{assert.equal(events[0],'download','Order list latency must not delay delivering the already-created PDF')}finally{resolveRefresh([order]);await pending}
 assert.equal(events.filter(event=>event==='refresh').length,1,'Refresh once after recording PDF delivery');
});

test('generated PDF is offered before marketplace confirmation completes',async()=>{
 const source=fs.readFileSync(new URL('../src/services/orders.ts',import.meta.url),'utf8');const body=source.slice(source.indexOf('export async function createOrderLabel('),source.indexOf('export async function fetchOrderLabel(')).replace('export async function createOrderLabel','globalThis.createOrderLabel=async function');
 const events=[];let complete;const confirmation=new Promise(resolve=>{complete=resolve});
 const context=vm.createContext({loadAutomationRule:async()=>({enabled:true,config:{pushToMarketplace:true}}),invokeMrw:async()=>({base64:'pdf'}),confirmOrderTracking:()=>{events.push('confirmation');return confirmation}});vm.runInContext(ts.transpile(body),context);const pending=context.createOrderLabel('order',{provider:'mrw'},true,async()=>events.push('download'));for(let i=0;i<10;i++)await Promise.resolve();
 try{assert.deepEqual(events,['download','confirmation'])}finally{complete();await pending}
});
