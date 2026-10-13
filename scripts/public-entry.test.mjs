import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import vm from 'node:vm';
const p=new URL('../src/services/publicEntry.ts',import.meta.url);
const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'export function shouldShowPresentation(){return false}',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:module.exports,URLSearchParams});
const show=module.exports.shouldShowPresentation;
test('signed out visitors see the presentation',()=>assert.equal(show(false,'',''),true));
test('authenticated visitors enter the application directly',()=>assert.equal(show(true,'',''),false));
test('the access button opens login instead of returning to the presentation',()=>assert.equal(show(false,'?acceso=1',''),false));
test('invitation recovery and OAuth entry links remain usable',()=>{for(const query of ['?invite_token=token','?recovery_token=token','?code=code','?shop=store&hmac=signature'])assert.equal(show(false,query,''),false);assert.equal(show(false,'','#access_token=token&type=recovery'),false)});
