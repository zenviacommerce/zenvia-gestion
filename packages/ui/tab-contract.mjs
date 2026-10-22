// Tooling export, not browser code. Consumers supply their TypeScript dev dependency.
import ts from 'typescript';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
export function customTabs(source,path='fixture.tsx'){
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),issues=[];
 const visit=node=>{
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
   // Intrinsic markup only; the exported Tabs component owns these attributes.
   if(/^[a-z]/.test(node.tagName.getText(ast)))for(const prop of node.attributes.properties){
    if(!ts.isJsxAttribute(prop))continue;const name=prop.name.getText(ast),text=prop.initializer?.getText(ast)||'';
    const role=name==='role'&&/['"](?:tab|tablist)['"]/.test(text);
    const selectableRole=node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)==='role'&&/['"](?:option|row|gridcell|treeitem)['"]/.test(p.initializer?.getText(ast)||''));
    const selected=name==='aria-selected'&&!selectableRole;
    const bespoke=name==='className'&&/\b(?:\w*Tabs|tabs|tabBar|tabList|tabNav|[\w-]*-tabs|expenseHubNav|settingsNav|sectionTabs)\b/.test(text);
    if(role||selected||bespoke){const line=ast.getLineAndCharacterOfPosition(prop.pos).line+1;issues.push(`${path}:${line}: use Tabs from @zenvia/ui (${name})`)}
   }
  }
  ts.forEachChild(node,visit);
 };visit(ast);return issues;
}
export async function auditTabs(root='src'){
 const issues=[];
 for(const item of await readdir(root,{withFileTypes:true})){const path=join(root,item.name);if(item.isDirectory())issues.push(...await auditTabs(path));else if(/\.tsx$/.test(item.name))issues.push(...customTabs(await readFile(path,'utf8'),path));else if(/\.css$/.test(item.name))issues.push(...customTabStyles(await readFile(path,'utf8'),path))}
 return issues;
}
export function customTabStyles(source,path='fixture.css'){
 const css=source.replace(/\/\*[\s\S]*?\*\//g,'');
 return [...css.matchAll(/([^{}]+)\{/g)].filter(match=>/\.(?:dsTabs\w*|dsTab\w*|\w+Tabs|expenseHubNav(?!Shell)\b|settingsNav\b)\b/.test(match[1])).map(()=>`${path}: tab styling belongs to @zenvia/ui`);
}
