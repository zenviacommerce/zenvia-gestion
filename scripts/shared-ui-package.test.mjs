import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('shared package pins the approved API at 0.2.0 without shipping another React or business services',async()=>{
 const pkg=JSON.parse(await readFile('packages/ui/package.json','utf8'));assert.equal(pkg.name,'@zenvia/ui');assert.equal(pkg.version,'0.2.0');assert.equal(pkg.dependencies?.react,undefined);assert.equal(pkg.peerDependencies.react,'19.2.1');
 const root=JSON.parse(await readFile('package.json','utf8'));assert.equal(root.dependencies['@zenvia/ui'],'0.2.0');
 const api=await import('../packages/ui/dist/index.js');for(const name of ['PageHeader','KpiGrid','StatCard','FilterBar','Tabs','PageTabs','DataTable','MobileList','FormModal','FormSection','FormGrid'])assert.equal(typeof api[name],'function',name);
 const before=await readFile('src/design-system.css','utf8');assert.match(before,/@import ['"]@zenvia\/ui\/styles.css['"]/);
});

test('extracted implementations and CSS match approved production sources (form stylesheet import stays in legacy shim)',async()=>{
 const {createHash}=await import('node:crypto');
 const baseline=JSON.parse(await readFile('packages/ui/approved-source-hashes.json','utf8'));
 assert.equal(baseline.baseline,'45441a470dd2ff30fc4d78020a0cc1309290bf6d');
 // Reviewed Tabs 0.2: only the compatibility alias and shared tab styles
 // differ from extraction. Keep every other approved production hash pinned.
 const workbenchHashes={
  'src/PageTabs.tsx':'bf71a9e55c43282d0c87eb7a9b3be9360c1a47e8ccfe6103c2bba97e17892da3',
  'src/styles.css':'ed5734521712bf8e1d6f556ddcdb70c573de4b633293de2d24146e93735c91d8',
 };
 for(const [path,entry] of Object.entries(baseline.sources)){
  const content=await readFile('packages/ui/'+path);
  assert.equal(createHash('sha256').update(content).digest('hex'),workbenchHashes[path]||entry.sha256,entry.original);
 }
 for(const name of ['styles.css','forms.css'])assert.equal(await readFile('packages/ui/dist/'+name,'utf8'),await readFile('packages/ui/src/'+name,'utf8'));

});

test('packed artifact renders in a separate consumer with external React and exported styles/types',async()=>{
 const {mkdtemp,mkdir,symlink,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const root=process.cwd(),temp=await mkdtemp(join(tmpdir(),'zenvia-ui-consumer-'));
 try{
  const packed=JSON.parse(execFileSync('npm',['pack','--workspace=@zenvia/ui','--ignore-scripts','--json','--pack-destination',temp],{encoding:'utf8'}))[0];
  assert.ok(packed.files.every(x=>!/(node_modules|services|supabase|\.env)/.test(x.path)));
  const module=join(temp,'node_modules/@zenvia/ui');await mkdir(module,{recursive:true});execFileSync('tar',['-xzf',join(temp,packed.filename),'-C',module,'--strip-components=1']);
  for(const name of ['react','react-dom','lucide-react','@types'])await symlink(resolve(root,'node_modules',name),join(temp,'node_modules',name),'dir');
  await writeFile(join(temp,'package.json'),'{"type":"module"}');
  await writeFile(join(temp,'consumer.mjs'),`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {KpiGrid,StatCard,TableSortReset,PageHeader,FormGrid} from '@zenvia/ui';
const h=React.createElement;
const html=renderToStaticMarkup(h('main',{},h(PageHeader,{title:'Compartido'}),h(KpiGrid,{label:'KPI'},h(StatCard,{label:'Pendientes',value:1,icon:'!',variant:'warning'})),h(TableSortReset,{sorting:{isDefaultSort:false,resetSort(){}}}),h(FormGrid,{},'Formulario')));
if(!html.includes('dashboardPendingOrders')||!html.includes('Restablecer orden')||!html.includes('Compartido'))throw Error('Lost exported behavior');
console.log('isolated consumer OK');`);
  assert.match(execFileSync(process.execPath,[join(temp,'consumer.mjs')],{encoding:'utf8'}),/isolated consumer OK/);
  await writeFile(join(temp,'consumer.tsx'),"import {KpiGrid,PageTabs,TableSortState,FormGrid} from '@zenvia/ui'; const order:TableSortState={key:'date',direction:'desc'};const page=<KpiGrid label='KPI'><FormGrid>Contenido</FormGrid></KpiGrid>;const tabs=<PageTabs label='Vista' value='all' items={[{id:'all',label:'Todos'}]} onChange={()=>{}}/>;void order;void page;void tabs;");
  execFileSync(resolve(root,'node_modules/.bin/tsc'),['--noEmit','--strict','--skipLibCheck','--module','ESNext','--moduleResolution','Bundler','--jsx','react-jsx','--target','ES2022','--lib','ES2022,DOM,DOM.Iterable',join(temp,'consumer.tsx')],{cwd:temp,encoding:'utf8'});
 }finally{await rm(temp,{recursive:true,force:true});}
});
