import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act,useEffect,useMemo,useState} from 'react';
import {Window} from 'happy-dom';
import {errorMessage} from '../src/services/toast.ts';

function component(path,name,context){
 const source=fs.readFileSync(path,'utf8').replace(/^import[\s\S]*?;\n/gm,'').replaceAll('export ','');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText;
 return vm.runInNewContext(code+'\n'+name,{React,useEffect,useMemo,useState,...context});
}
test('Gmail checkboxes import a selected batch and advance through manual reviews',async()=>{
 const window=new Window();const previous={};
 for(const name of ['window','document','HTMLElement','Node','Event','MouseEvent','IS_REACT_ACT_ENVIRONMENT']){previous[name]=globalThis[name];globalThis[name]=name==='IS_REACT_ACT_ENVIRONMENT'?true:window[name]||window;}
 const {createRoot}=await import('react-dom/client');const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const rows=['a','b','done'].map((id,index)=>({id,messageId:id,attachmentId:id,attachmentName:id+'.pdf',status:id==='done'?'imported':'found',metadata:{},integrationAccountId:'mail'}));
 const seen=[];let refreshed=0;
 const checkbox=component('src/components/BulkSelectionToolbar.tsx','BulkSelectCheckbox',{});
 const toolbar=component('src/components/BulkSelectionToolbar.tsx','BulkSelectionToolbar',{BulkSelectCheckbox:checkbox});
 const batch=component('src/services/gmailBulkImport.ts','runGmailImportBatch',{errorMessage});
 const icon=()=>React.createElement('span');
 const icons=Object.fromEntries('AlertCircle CheckCircle2 ChevronLeft ChevronRight ExternalLink Eye FileText Link2 LoaderCircle Mail Paperclip RefreshCw Search ShieldCheck Sparkles X'.split(' ').map(name=>[name,icon]));
 const SelectField=({value,onChange,options,disabled})=>React.createElement('select',{value,disabled,onChange:e=>onChange(e.target.value)},options.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label)));
 const Page=component('src/pages/Gmail.tsx','GmailPage',{...icons,errorMessage,SelectField,BulkSelectCheckbox:checkbox,BulkSelectionToolbar:toolbar,runGmailImportBatch:batch,useImportActivity(){},isDecorativeGmailImage:()=>false,
  loadRecoverableGmailImports:async()=>rows,loadRegisteredGmailAccounts:async()=>[{id:'mail',externalAccountId:'mail@example.com',config:{}}],selectDefaultGmailAccount:accounts=>accounts[0],getCachedGmailConnection:()=>({email:'mail@example.com',accessToken:'token'}),gmailOAuthConfigured:()=>true,gmailMessageUrl:()=>'',
  ensureRegisteredGmailConnection:async()=>({email:'mail@example.com',accessToken:'token'}),InvoiceCandidateForm:({candidate})=>React.createElement('div',null,'Review '+candidate.invoiceNumber),
  importGmailCandidate:async(token,source)=>{seen.push(source.id);source.status='error';source.metadata={reviewRequired:true};return {kind:'review',candidate:{invoiceNumber:source.id}};},
  saveReviewedGmailCandidate:async(source)=>{source.status='imported';source.metadata={};},
 });
 try{
  await act(async()=>{root.render(React.createElement(Page,{categories:[],onImported:async()=>{refreshed++},onManageAccounts(){},canManageAccounts:true}));});
  const boxes=[...host.querySelectorAll('input[type=checkbox]')];assert.equal(boxes.length,4);assert.equal(boxes[3].disabled,true);
  await act(async()=>{boxes[0].click();});
  const importButton=[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Importar seleccionadas'));assert.match(importButton.textContent,/\(2\)/);
  await act(async()=>{importButton.click();});assert.deepEqual(seen,['a','b']);assert.match(host.textContent,/Review a/);
  assert.equal([...host.querySelectorAll('input[type=checkbox]')].every(b=>b.disabled),true);
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Guardar factura revisada')).click();});assert.match(host.textContent,/Review b/);
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Guardar factura revisada')).click();});assert.equal(host.querySelector('.gmailReviewModal'),null);assert.equal(refreshed,2);
 }finally{await act(async()=>root.unmount());await window.happyDOM.close();for(const [name,value] of Object.entries(previous))if(value===undefined)delete globalThis[name];else globalThis[name]=value;}
});
