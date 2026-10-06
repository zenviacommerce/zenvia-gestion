import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import {build,stop} from 'esbuild';
import {Window} from 'happy-dom';

const eventually=async(condition)=>{for(let i=0;i<100;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error('UI state did not settle');};
test('closing the import window preserves progress; remount restores the saved review and confirms its version',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'zenvia-ui-'));
 const window=new Window({url:'http://localhost:5173/scripts/fixtures/import-ui.html'});
 const restore=new Map();for(const name of ['MessageChannel','BroadcastChannel','window','document','navigator','localStorage','sessionStorage','HTMLElement','HTMLInputElement','Event','CustomEvent','File','Blob','Response','Headers','Request']){restore.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value:['MessageChannel','BroadcastChannel'].includes(name)?undefined:name==='window'?window:window[name],configurable:true,writable:true});}
 const oldFetch=globalThis.fetch;globalThis.fetch=(...args)=>window.fetch(...args);
 try{
  document.body.innerHTML='<div id="root"></div>';
  const result=await build({entryPoints:['scripts/fixtures/import-ui.tsx'],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',target:'es2022',loader:{'.css':'empty'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'}});
  const code=result.outputFiles[0].text,file=join(temporary,'fixture.mjs');await writeFile(file,code);const url=pathToFileURL(file).href;
  await import(url+'#initial');
  await eventually(()=>document.body.textContent.includes('Analizando'));
  document.querySelector('.formModalClose').click();
  await eventually(()=>!document.querySelector('.modalBackdrop'));
  assert.equal(window.__fixtureJob().status,'running');
  [...document.querySelectorAll('button')].find(b=>b.textContent==='Simular finalización').click();
  await eventually(()=>window.__fixtureJob().status==='waiting_review');
  window.__fixtureRoot.unmount();document.body.innerHTML='<div id="root"></div>';
  await import(url+'#reload');
  await eventually(()=>document.querySelector('button.importHistoryRow')?.textContent.includes('Pendiente de revisión'));
  document.querySelector('button.importHistoryRow').click();
  await eventually(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Revisar'));
  [...document.querySelectorAll('button')].find(b=>b.textContent==='Revisar').click();
  await eventually(()=>document.querySelector('input[value="F-123"]'));
  const confirm=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar datos e importar');assert.ok(confirm);confirm.click();
  await eventually(()=>window.__reviewed?.invoiceNumber==='F-123');
  assert.equal(window.__reviewed.total,121);assert.equal(window.__fixtureJob().status,'queued');assert.equal(window.__reviewed.file,undefined);
  window.__fixtureRoot.unmount();
 }finally{stop();for(const cleanup of window.__fixtureCleanups||[])cleanup();for(const client of window.__fixtureClients||[])await client.auth.stopAutoRefresh();globalThis.fetch=oldFetch;await window.happyDOM.close();await rm(temporary,{recursive:true,force:true});for(const [name,descriptor] of restore){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
