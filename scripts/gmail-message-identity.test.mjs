import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

function service(path,context,expression){
 const code=stripTypeScriptTypes(fs.readFileSync(path,'utf8').replace(/^import[\s\S]*?;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.env.VITE_GOOGLE_CLIENT_ID','undefined'));
 return vm.runInNewContext(code+'\n'+expression,{Error,File,Response,console,atob,Uint8Array,TextEncoder,Date,...context});
}
function scanner(labelIds=[]){
 const urls=[];
 const scan=service('src/services/gmailStableSearch.ts',{
  errorMessage:e=>e.message,window:{setTimeout:fn=>{fn();return 1}},localStorage:{getItem:()=>null,setItem(){}},
  shouldInspectInvoiceAttachment:()=>true,classifyInvoiceFile:async()=>({isInvoice:true,score:10,signals:[],negativeSignals:[]}),
  downloadGmailAttachment:async()=>new File(['invoice'],'invoice.pdf'),invalidateGmailAuthorization(){},
  fetch:async url=>{urls.push(url);return new Response(JSON.stringify(url.includes('?maxResults=')?{messages:[{id:'msg'}]}:{id:'msg',labelIds,payload:{parts:[{partId:'1',filename:'invoice.pdf',mimeType:'application/pdf',body:{attachmentId:'changing-token',size:100}}]}}))},
 },'searchGmailInvoiceCandidatesStable');
 return {scan,urls};
}
for(const label of ['SENT','DRAFT','TRASH','SPAM'])test(`scanner rejects ${label} even when Gmail list includes it`,async()=>{
 const {scan}=scanner([label]);const saved=[];
 const result=await scan('token',12,'any@example.org',[],undefined,async items=>saved.push(...items));
 assert.equal(result.candidates.length,0);assert.equal(saved.length,0);
});
test('received archived supplier invoices remain eligible and searches exclude outbound mail',async()=>{
 const {scan,urls}=scanner([]);const result=await scan('token',12,'any@example.org',[]);
 assert.equal(result.candidates.length,1);
 const query=new URL(urls[0]).searchParams.get('q');
 assert.match(query,/-in:sent/);assert.match(query,/-in:drafts/);assert.doesNotMatch(query,/\bin:inbox\b/);
});
test('registry hides superseded search records while keeping the imported canonical record',async()=>{
 const canonical={id:'original',gmail_message_id:'msg',attachment_id:'old-token',attachment_name:'invoice.pdf',status:'imported',invoice_id:'expense',metadata:{partId:'1'}};
 const duplicate={...canonical,id:'repeat',status:'found',invoice_id:null,metadata:{partId:'1',supersededBy:'original'}};
 const load=service('src/services/gmail.ts',{supabase:{from:()=>({select:()=>({order:async()=>({data:[canonical,duplicate],error:null})})})}},'loadGmailImports');
 const rows=await load();assert.equal(rows.length,1);assert.equal(rows[0].id,'original');assert.equal(rows[0].invoiceId,'expense');
});
