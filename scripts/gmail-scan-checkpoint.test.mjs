import {errorMessage} from '../src/services/toast.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
function scanner(){
 const values=new Map();
 const source=fs.readFileSync('src/services/gmailStableSearch.ts','utf8').replace(/^import[\s\S]*?;\n/gm,'').replaceAll('export ','');
 const code=stripTypeScriptTypes(source);
 const scan=vm.runInNewContext(code+'\nsearchGmailInvoiceCandidatesStable',{Error,File,Response,errorMessage,console:{warn(){}},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},window:{setTimeout:fn=>{fn();return 1}},shouldInspectInvoiceAttachment:()=>true,downloadGmailAttachment:async()=>new File(['invoice'],'factura.pdf',{type:'application/pdf'}),classifyInvoiceFile:async()=>({isInvoice:true,score:1,signals:[],negativeSignals:[]}),invalidateGmailAuthorization(){},fetch:async url=>new Response(JSON.stringify(url.includes('?maxResults=')?{messages:[{id:'message'}]}:{id:'message',payload:{parts:[{filename:'factura.pdf',mimeType:'application/pdf',body:{attachmentId:'a',size:100}},{filename:'factura.pdf',mimeType:'application/pdf',body:{attachmentId:'b',size:100}}]}}),{status:200})});
 return {scan,values};
}
test('a failed persistence checkpoint leaves the whole message retryable',async()=>{
 const {scan,values}=scanner();let calls=0;
 await assert.rejects(scan('token',12,'account',[],undefined,async candidates=>{calls++;assert.equal(candidates.length,2);throw new Error('database unavailable');}),/guard|database unavailable/i);
 assert.equal(calls,1);assert.ok([...values.values()].every(v=>!v.includes('message')));
 const saved=[];await scan('token',12,'account',[],undefined,async candidates=>saved.push(...candidates));
 assert.deepEqual(saved.map(c=>c.attachmentId),['a','b']);assert.ok([...values.values()].some(v=>v.includes('message')));
});
test('Gmail displays the message from a structured database error',()=>{
 const source=fs.readFileSync('src/pages/Gmail.tsx','utf8');const match=source.match(/function gmailConnectionError[\s\S]*?\n}\n/);
 const fn=vm.runInNewContext(stripTypeScriptTypes(match[0])+'\ngmailConnectionError',{Error,errorMessage});
 assert.match(fn({message:'No se pudo guardar el adjunto',code:'23505'}),/No se pudo guardar el adjunto/);assert.doesNotMatch(fn({code:'23505'}),/object Object/);
});
