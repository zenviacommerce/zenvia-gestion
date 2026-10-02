import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../supabase/functions/_shared/agentTools.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {validateToolCall}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const tool={tool_key:'record.change',enabled:true,permission:'records',action_type:'write',requires_confirmation:false,args_schema:{type:'object',additionalProperties:false,required:['id','days'],properties:{id:{type:'string',minLength:1},days:{type:'integer',minimum:1,maximum:365}}}};
for(const [name,args,permissions,confirmed,code] of [
 ['valid write',{id:'record-1',days:10},['records'],true,null],
 ['write needs confirmation even if metadata flag is wrong',{id:'record-1',days:10},['records'],false,'confirmation_required'],
 ['permission cannot be elevated',{id:'record-1',days:10},[],true,'permission_denied'],
 ['action cannot override handler',{id:'record-1',days:10,action:'delete_all'},['records'],true,'invalid_arguments'],
 ['missing ID',{days:10},['records'],true,'invalid_arguments'],
 ['numeric strings are rejected',{id:'record-1',days:'10'},['records'],true,'invalid_arguments'],
 ['negative trial rejected',{id:'record-1',days:-1},['records'],true,'invalid_arguments'],
 ['oversized trial rejected',{id:'record-1',days:366},['records'],true,'invalid_arguments'],
])test(name,()=>assert.equal(validateToolCall(tool,args,permissions,confirmed)?.code??null,code));
test('disabled tools fail closed',()=>assert.equal(validateToolCall({...tool,enabled:false},{id:'x',days:10},['records'],true).code,'tool_disabled'));
test('destructive tools always require confirmation',()=>assert.equal(validateToolCall({...tool,action_type:'destructive'}, {id:'x',days:10},['records'],false).code,'confirmation_required'));
test('reads need no confirmation',()=>assert.equal(validateToolCall({...tool,action_type:'read'},{id:'x',days:10},['records'],false),null));
