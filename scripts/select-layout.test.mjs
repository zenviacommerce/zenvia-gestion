import test from 'node:test';
import assert from 'node:assert/strict';

import {readReviewFile as readFile} from './review-file-loader.mjs';
import {Window} from 'happy-dom';

test('shared dropdown preserves long selected labels and vertical-only option scrolling',async()=>{
 const window=new Window();
 try{
  const {document}=window;
  const css=await readFile(new URL('../src/shared-forms.css',import.meta.url),'utf8');
  document.head.innerHTML=`<style>${css}</style>`;
  document.body.innerHTML='<div class="searchableSelect"><button class="searchableSelectTrigger"><span>DISTRIBUCIONES CABAPLAST 99 S.L</span><svg></svg></button></div><div class="searchableSelectMenu" style="width:235px"><div class="search"><input class="searchableSelectSearch"></div><div class="searchableSelectList"><button class="searchableSelectOption isSelected"><span>DISTRIBUCIONES CABAPLAST 99 S.L<svg></svg></span></button><button class="searchableSelectOption"><span>CORREOS EXPRESS PAQUETERÍA URGENTE, S.A.</span><small>proveedor-con-descripcion-larga-sin-espacios</small></button></div></div>';
  const style=selector=>window.getComputedStyle(document.querySelector(selector));
  assert.equal(style('.searchableSelectList').overflowX,'hidden');
  assert.equal(style('.searchableSelectList').overflowY,'auto');
  assert.equal(style('.searchableSelectOption').alignItems,'stretch');
  assert.equal(style('.searchableSelectOption').boxSizing,'border-box');
  assert.equal(style('.searchableSelectOption').flexShrink,'0');
  assert.equal(style('.searchableSelectOption>span').overflowWrap,'anywhere');
  assert.equal(style('.searchableSelectOption>small').whiteSpace,'normal');
  assert.equal(style('.searchableSelectTrigger>span').minWidth,'0');
  assert.equal(style('.searchableSelectTrigger>svg').flexShrink,'0');
  assert.equal(style('.searchableSelectOption>span').textAlign,'left');
 }finally{window.happyDOM.close();}
});
