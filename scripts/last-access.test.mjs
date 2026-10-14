import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
const source=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
function setup(){
 const start=source.indexOf(' // Record application use');
 assert.ok(start>=0,'Application must record restored sessions');
 const end=source.indexOf(' },[userId,access?.active,authClientVersion]);',start);
 assert.ok(end>start);
 const body=source.slice(start,end).split(' useEffect(()=>{')[1];
 const window=new Window();
 Object.defineProperty(window.document,'visibilityState',{value:'visible',configurable:true});
 let writes=0,cleanup;
 const supabase={rpc:async()=>{writes++;return {error:null}}};
 const effect=new Function('window','document','navigator','supabase','userId','access',body);
 cleanup=effect(window,window.document,window.navigator,supabase,'user-1',{active:true});
 return {window,writes:()=>writes,cleanup};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('restored sessions record access; hidden tabs do not; returning records again',async()=>{
 const s=setup();await tick();assert.equal(s.writes(),1);
 Object.defineProperty(s.window.document,'visibilityState',{value:'hidden',configurable:true});
 s.window.document.dispatchEvent(new s.window.Event('visibilitychange'));await tick();assert.equal(s.writes(),1);
 Object.defineProperty(s.window.document,'visibilityState',{value:'visible',configurable:true});
 s.window.document.dispatchEvent(new s.window.Event('visibilitychange'));await tick();assert.equal(s.writes(),2);
 s.cleanup();s.window.dispatchEvent(new s.window.Event('focus'));await tick();assert.equal(s.writes(),2);
 await s.window.happyDOM.close();
});
