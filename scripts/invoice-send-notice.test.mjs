import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/components/SendInvoiceModal.tsx',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('  const send=async()=>'),source.indexOf('\n  return <div',source.indexOf('  const send=async()=>')));
function setup(fail=false){
 const events=[];
 const context=vm.createContext({to:'cliente@example.com',subject:'Factura',body:'Adjunta',invoice:{id:'invoice-50',invoiceNumber:'F202650'},settings:{},branding:null,appSettings:{sales:{},general:{}},setError:()=>events.push('error'),setBusy:()=>{},createSalesInvoicePdfBlob:()=>({}),salesInvoicePdfFilename:()=> 'F202650.pdf',sendInvoiceViaGmail:async()=>{if(fail)throw Error('Gmail failed');events.push('gmail')},markSalesInvoiceSent:async()=>events.push('marked'),onSent:async()=>events.push('refreshed'),showSuccess:message=>events.push(message),onClose:()=>events.push('closed'),errorMessage:()=> 'failed'});
 vm.runInContext(ts.transpile(handler)+';globalThis.send=send;',context);return {context,events};
}
test('shared sender confirms the invoice number and recipient after successful sending',async()=>{
 const {context,events}=setup();await context.send();
 assert(events.some(e=>e.includes('F202650')&&e.includes('cliente@example.com')));assert(events.indexOf('marked')<events.findIndex(e=>e.includes('F202650')));assert.equal(events.at(-1),'closed');
});
test('Gmail failure never displays a success notice',async()=>{
 const {context,events}=setup(true);await context.send();assert(!events.some(e=>e.includes('F202650')));assert(!events.includes('closed'));
});
