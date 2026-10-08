import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {build,stop} from 'esbuild';import {Window} from 'happy-dom';
const settle=async(fn)=>{for(let n=0;n<80;n++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error('State did not settle');};
test('disabled filter memory resets retained screens without discarding imports or reviews',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'filter-memory-')),window=new Window(),previous=new Map();
 for(const key of ['window','document','navigator','HTMLElement','Event','CustomEvent','MessageChannel']){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true,writable:true});}
 try{document.body.innerHTML='<div id="root"></div>';const result=await build({entryPoints:['scripts/fixtures/filter-memory.tsx'],write:false,bundle:true,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});const file=join(dir,'fixture.mjs');await writeFile(file,result.outputFiles[0].text);await import(pathToFileURL(file).href);
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text),filter=()=>document.querySelector('[data-filter]')?.textContent;
 await settle(()=>filter()==='initial');button('Filtrar').click();button('Revisar').click();await settle(()=>filter()==='chosen');
 button('Navegar').click();await settle(()=>document.querySelector('[hidden]'));button('Navegar').click();await settle(()=>!document.querySelector('[hidden]'));await new Promise(r=>setTimeout(r,50));
 assert.equal(filter(),'initial');assert.equal(document.querySelector('[data-review]').textContent,'reviewed');assert.equal(window.fixtureMounts(),1);
 button('Recordar').click();await new Promise(r=>setTimeout(r,25));button('Filtrar').click();await settle(()=>filter()==='chosen');button('Navegar').click();await settle(()=>document.querySelector('[hidden]'));button('Navegar').click();await settle(()=>!document.querySelector('[hidden]'));assert.equal(filter(),'chosen');
 button('Recordar').click();await settle(()=>filter()==='initial');assert.equal(window.fixtureMounts(),1);window.fixtureRoot.unmount();
 }finally{stop();await window.happyDOM.close();await rm(dir,{recursive:true,force:true});for(const [key,value] of previous){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
});
