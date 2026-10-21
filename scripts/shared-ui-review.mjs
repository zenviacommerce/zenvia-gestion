import {spawn} from 'node:child_process';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,relative} from 'node:path';
const baseline='45441a470dd2ff30fc4d78020a0cc1309290bf6d';
const root=process.env.UI_REVIEW_ROOT||'docs/deploy/ui-extraction-20261021/review';
const jobs=[['phase-1','design-phase1-screenshots.mjs'],['phase-2','design-phase2-screenshots.mjs'],['masters','design-phase3-masters-screenshots.mjs'],['commerce','design-phase3-commerce-screenshots.mjs'],['final','design-phase3-final-screenshots.mjs']];
await mkdir(root,{recursive:true});
async function run(kind,[name,file]){
 const output=join(root,kind,name);
 await new Promise((resolve,reject)=>{
  const proc=spawn(process.execPath,['scripts/'+file,'capture'],{env:{...process.env,UI_EXTRACTION_OUTPUT:output,UI_CAPTURE_SOURCE:kind==='before'?baseline:''},stdio:['ignore','pipe','pipe']});let log='';
  proc.stdout.on('data',x=>{log+=x});proc.stderr.on('data',x=>{log+=x});
  proc.on('error',reject);proc.on('close',async code=>{await writeFile(join(root,kind+'-'+name+'.log'),log);code===0?resolve():reject(Error(file+': '+log.slice(-2500)));});
 });
}
for(const kind of ['before','after'])for(let n=0;n<jobs.length;n+=2)await Promise.all(jobs.slice(n,n+2).map(job=>run(kind,job)));
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);out.push(...(e.isDirectory()?await walk(p):p.endsWith('.png')?[p]:[]));}return out;}
const pairs=[];const sha=x=>createHash('sha256').update(x).digest('hex');
for(const path of await walk(join(root,'before'))){
 const name=relative(join(root,'before'),path);const before=await readFile(path),after=await readFile(join(root,'after',name));const identical=before.equals(after);
 pairs.push({path:name,beforeSha256:sha(before),afterSha256:sha(after),identical});
}
if(pairs.length<45)throw Error('Incomplete screen coverage: '+pairs.length);
await writeFile(join(root,'comparison.json'),JSON.stringify({baseline,pairs,identical:pairs.every(x=>x.identical)},null,2)+'\n');
if(pairs.some(x=>!x.identical))throw Error('Visual extraction changed: '+pairs.filter(x=>!x.identical).map(x=>x.path).join(', '));
console.log('Shared UI extraction: '+pairs.length+' PNG pairs byte-identical (stronger than pixel equality).');
