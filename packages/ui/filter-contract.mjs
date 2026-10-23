import ts from 'typescript';import{readdir,readFile}from'node:fs/promises';import{join}from'node:path';
export function rawFilterControls(source,path='component.tsx'){
 const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),findings=[];
 const name=node=>node.tagName?.getText(file);
 const literal=(node,key)=>{const attr=node.attributes?.properties.find(p=>ts.isJsxAttribute(p)&&p.name.text===key);return attr?.initializer&&ts.isStringLiteral(attr.initializer)?attr.initializer.text:''};
 const sharedFilter=node=>{for(let p=node.parent;p;p=p.parent)if((ts.isJsxElement(p)&&['FilterBar','SearchFilters'].includes(p.openingElement.tagName.getText(file)))||(ts.isJsxSelfClosingElement(p)&&p.tagName.getText(file)==='SearchFilters'))return true;return false};
 const visit=node=>{if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
  if(name(node)==='SelectField'&&/^filtrar/i.test(literal(node,'ariaLabel'))&&!sharedFilter(node))findings.push({path,position:node.getStart(file),reason:'List filter selectors belong inside SearchFilters or the shared structured FilterBar.'});
  if(name(node)==='select')findings.push({path,position:node.getStart(file),reason:'Use the shared SelectField for filter controls.'});
  if(name(node)==='input'&&literal(node,'role')!=='combobox'&&(literal(node,'type')==='search'||/^buscar|^search/i.test(literal(node,'placeholder'))||/^buscar|^search/i.test(literal(node,'aria-label'))))findings.push({path,position:node.getStart(file),reason:'Use the shared SearchField; FilterBar does not style native search inputs.'});
 }ts.forEachChild(node,visit)};visit(file);return findings;
}
export async function auditFilterControls(root='src'){const result=[];async function walk(path){for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())await walk(file);else if(/\.tsx$/.test(file))result.push(...rawFilterControls(await readFile(file,'utf8'),file))}}await walk(root);return result}
