// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import ts from 'typescript';
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(join(dir,x.name)):/\.tsx?$/.test(x.name)?[join(dir,x.name)]:[])}
it('every app signOut has an explicit local/global scope; ordinary exits stay local',()=>{const missing:string[]=[];const wrong:string[]=[];for(const path of files('src')){const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);function visit(n:ts.Node){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='signOut'){const a=n.arguments[0];const p=a&&ts.isObjectLiteralExpression(a)?a.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='scope'):null;const value=p&&ts.isPropertyAssignment(p)&&ts.isStringLiteral(p.initializer)?p.initializer.text:null;if(!['local','global'].includes(value||''))missing.push(path+':'+n.getText(source));if(/App\.tsx|MfaScreen\.tsx|MfaDevices\.tsx/.test(path)&&value!=='local')wrong.push(path+':'+n.getText(source))}ts.forEachChild(n,visit)}visit(source)}expect(missing).toEqual([]);expect(wrong).toEqual([])});
