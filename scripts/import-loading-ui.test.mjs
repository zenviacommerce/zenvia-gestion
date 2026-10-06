import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {build,stop} from 'esbuild';import {Window} from 'happy-dom';
const settle=async(fn)=>{for(let n=0;n<80;n++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error('State did not settle');};
test('navigation preserves running imports, review state and the global activity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'loading-ui-')),window=new Window(),previous=new Map();
 for(const key of ['window','document','navigator','HTMLElement','Event','CustomEvent','MessageChannel']){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true,writable:true});}
 try{document.body.innerHTML='<div id="root"></div>';const result=await build({entryPoints:['scripts/fixtures/retained-import.tsx'],write:false,bundle:true,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});const file=join(dir,'fixture.mjs');await writeFile(file,result.outputFiles[0].text);await import(pathToFileURL(file).href);
 await settle(()=>window.fixtureActivities?.().length===1);const id=window.fixtureActivities()[0].id;const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 button('Cambiar sección').click();await settle(()=>document.querySelector('[hidden]'));assert.equal(window.fixtureActivities()[0].id,id);
 button('Completar análisis').click();await settle(()=>window.fixtureActivities()[0].detail==='Revisión preparada');
 button('Cambiar sección').click();await settle(()=>!document.querySelector('[hidden]'));assert.equal(document.querySelector('input').value,'Factura 123');assert.equal(window.fixtureMounts(),1);
 button('Guardar').click();await settle(()=>window.fixtureActivities().length===0);window.fixtureRoot.unmount();
 }finally{stop();await window.happyDOM.close();await rm(dir,{recursive:true,force:true});for(const [key,value] of previous){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
});
