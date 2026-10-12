import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath=path.join(root,'public','manifest.webmanifest');
const generatorPath=path.join(root,'scripts','generate-brand-icon.mjs');

test('home-screen metadata uses the ZENVIA brand icon without install UI',()=>{
  assert.ok(existsSync(manifestPath),'public/manifest.webmanifest must exist');
  assert.ok(existsSync(generatorPath),'brand icon generator must exist');

  const index=readFileSync(path.join(root,'index.html'),'utf8');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
  const app=readFileSync(path.join(root,'src','App.tsx'),'utf8');

  assert.match(index,/rel="manifest" href="\/manifest-ios-fixed-20261012\.webmanifest"/);
  assert.match(index,/rel="apple-touch-icon" sizes="180x180" href="__ZENVIA_IOS_TOUCH_ICON_DATA__"/);
  assert.doesNotMatch(index,/rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/);
  assert.equal(manifest.name,'ZENVIA Gestión');
  assert.equal(manifest.short_name,'ZENVIA Gestión');
  assert.ok(manifest.icons?.some(icon=>icon.src==='/zenvia-ios-home-180-v3.png'));
  assert.ok(manifest.icons?.every(icon=>icon.type==='image/png'));
  assert.ok(existsSync(path.join(root,'public','apple-touch-icon.png')));
  assert.ok(existsSync(path.join(root,'public','zenvia-brand-symbol-20261012.png')));
  assert.match(pkg.scripts.build,/generate-brand-icon\.mjs/);
  assert.match(pkg.scripts.dev,/generate-brand-icon\.mjs/);
  assert.doesNotMatch(app,/InstallAppPrompt|beforeinstallprompt|Añadir a pantalla de inicio|Instalar aplicación/);
});
