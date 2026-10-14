import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
test('an open dashboard refreshes once at Madrid midnight and again on return after sleeping',async()=>{
 let source='';try{source=await readFile('src/services/amazonCalendar.ts','utf8')}catch{}assert.ok(source,'Amazon needs a calendar-day watcher');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;const api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const RealDate=globalThis.Date;let now=new RealDate('2026-10-14T21:59:00Z');class Clock extends RealDate{constructor(...args){super(...(args.length?args:[now.getTime()]));}}globalThis.Date=Clock;
 const events=new Map();let tick,cleared=false;globalThis.window={setInterval:fn=>{tick=fn;return 1},clearInterval:()=>cleared=true,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};globalThis.document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const changes=[];const stop=api.watchAmazonCalendarDay((previous,next)=>changes.push([previous,next]),'Europe/Madrid');
 try{tick();assert.equal(changes.length,0);now=new RealDate('2026-10-14T22:01:00Z');tick();tick();assert.deepEqual(changes,[['2026-10-14','2026-10-15']]);now=new RealDate('2026-10-17T10:00:00Z');events.get('focus')();assert.equal(changes.length,2);assert.equal(changes[1][1],'2026-10-17');}finally{stop();globalThis.Date=RealDate;}
 assert.ok(cleared);assert.equal(events.size,0);
});
