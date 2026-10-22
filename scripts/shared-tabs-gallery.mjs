import {readFile,readdir,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const root='docs/deploy/20261022-shared-tabs-review',pairs=[];
for(const file of (await readdir(root+'/before')).filter(x=>x.endsWith('.json')&&x!=='comparison.json')){
 const before=JSON.parse(await readFile(root+'/before/'+file,'utf8')),after=JSON.parse(await readFile(root+'/after/'+file,'utf8'));
 const old=Array.isArray(before)?before:before.checks,now=Array.isArray(after)?after:after.checks;
 for(const row of old){const updated=now.find(r=>r.width===row.width&&r.theme===row.theme&&r.screen===row.screen);assert.ok(updated,'missing '+row.file);assert.deepEqual(updated.tabs,row.tabs,'tab inventory '+row.file);assert.deepEqual(updated.actions,row.actions,'action inventory '+row.file);assert.equal(updated.overflow,false,row.file);
  const hashes={};for(const side of ['before','after'])hashes[side]=createHash('sha256').update(await readFile(root+'/'+side+'/'+row.file)).digest('hex');pairs.push({screen:row.screen||'platform-client',width:row.width,theme:row.theme,file:row.file,sha256:hashes,headerActionsPreserved:true,tabsPreserved:true});
 }
}
assert.equal(pairs.length,54,'8 Gestión +1 Platform ×3 widths ×2 themes');
await writeFile(root+'/comparison.json',JSON.stringify({synthetic:true,networkBlocked:true,pairs},null,2)+'\n');
const text=['# Pestañas compartidas — revisión antes/después','','Sin publicar. Datos sintéticos; componentes reales con servicios simulados y red bloqueada. 54 pares (108 PNG). No se han emitido documentos ni modificado producción.','','Configuración usa ahora una fila horizontal también en escritorio. Sus descripciones se ajustan sin truncar los títulos. Los demás nombres, contadores y acciones se conservan.','', '| Pantalla · ancho · tema | Antes | Después |','|---|---|---|',...pairs.map(r=>`| ${r.screen} · ${r.width} · ${r.theme} | [Ver](before/${r.file}) | [Ver](after/${r.file}) |`),'','Ver comparison.json para hashes e inventario de pestañas y acciones de cabecera (Platform: acciones del modal). Los datos personales mostrados son ficticios.'];
await writeFile(root+'/README.md',text.join('\n')+'\n');console.log(pairs.length+' pairs: actions and tabs preserved');
