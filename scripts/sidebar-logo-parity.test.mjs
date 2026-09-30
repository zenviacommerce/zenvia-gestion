import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Gestión sidebar logo keeps Platform dimensions',async()=>{
  const css=await readFile(new URL('../src/sidebar-brand.css',import.meta.url),'utf8');
  assert.match(css,/\.sidebar \.brandLogo\{[\s\S]*?width:156px;/);
  assert.match(css,/max-width:100%/);
  assert.doesNotMatch(css,/max-height:64px/);
  assert.doesNotMatch(css,/\.sidebar \.brandLogo\{[\s\S]*?box-shadow:0 10px 26px/);
});
