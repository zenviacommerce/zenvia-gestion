import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function legacyWrappers(source){
 const file=ts.createSourceFile('component.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const counts={};
 function walk(node){
  if(ts.isJsxAttribute(node)&&node.name.getText(file)==='className'&&node.initializer){
   function values(value){
    if(ts.isStringLiteral(value)||ts.isNoSubstitutionTemplateLiteral(value)){for(const token of value.text.split(/\s+/))if(['stats','stat','pageHead'].includes(token))counts[token]=(counts[token]||0)+1;return;}
    ts.forEachChild(value,values);
   }values(node.initializer);
  }ts.forEachChild(node,walk);
 }walk(file);return counts;
}
export function contractViolations(files,baseline){
 const failures=[];
 for(const [path,source] of Object.entries(files)){
  if(['src/components/StatCard.tsx','src/components/PageHeader.tsx','packages/ui/src/StatCard.tsx','packages/ui/src/PageHeader.tsx'].includes(path))continue;
  for(const [token,count] of Object.entries(legacyWrappers(source)))if(count>(baseline[path]?.[token]||0))failures.push(`${path}: use shared ${token==='pageHead'?'PageHeader':'KpiGrid / StatCard'} instead of new '${token}' wrappers`);
  const isNewPage=path.startsWith('src/pages/')&&!Object.hasOwn(baseline,path);
  if(isNewPage&&!source.includes('<PageHeader'))failures.push(`${path}: new pages require PageHeader`);
  if(!Object.hasOwn(baseline,path)&&source.includes('<StatCard')&&!source.includes('<KpiGrid'))failures.push(`${path}: KPI cards require KpiGrid`);
 }return failures;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const baseline=JSON.parse(readFileSync('scripts/design-contract-legacy.json','utf8'));
 const files={};for(const dir of ['src/pages','src/components','packages/ui/src'])for(const entry of readdirSync(dir,{recursive:true}))if(entry.endsWith('.tsx')){const path=dir+'/'+entry;files[path]=readFileSync(path,'utf8');}
 const failures=contractViolations(files,baseline);if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Design contract: no new legacy KPI/header wrappers; new pages use shared components.');
}
