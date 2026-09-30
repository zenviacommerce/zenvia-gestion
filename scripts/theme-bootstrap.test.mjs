import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('theme is applied in HTML before React bootstraps',async()=>{
  const html=await read('../index.html');
  const bootstrap=html.indexOf('zenvia-gestion-theme-preference');
  const app=html.indexOf('/src/main.tsx');
  assert.ok(bootstrap>0);
  assert.ok(app>bootstrap);
  assert.match(html,/document\.documentElement\.dataset\.theme=theme/);
  assert.doesNotMatch(html,/prefers-color-scheme/);
});

test('SettingsProvider starts from cached global preference or last resolved theme',async()=>{
  const source=await read('../src/context/SettingsContext.tsx');
  assert.match(source,/function initialUserPreferences/);
  assert.match(source,/zenvia-gestion-theme-preference/);
  assert.match(source,/zenvia-gestion-theme/);
  assert.match(source,/useState<UserPreferences>\(initialUserPreferences\)/);
  assert.doesNotMatch(source,/cached==='system'/);
  const noUserBlock=source.match(/if\(!effectiveUserId\)\{[\s\S]*?return;\s*\}/)?.[0]||'';
  assert.doesNotMatch(noUserBlock,/setPreferences\(clone\(DEFAULT_USER_PREFERENCES\)\)/);
});

test('App caches global preference, resolved visual theme and a device-local override',async()=>{
  const source=await read('../src/App.tsx');
  assert.match(source,/THEME_PREFERENCE_KEY = 'zenvia-gestion-theme-preference'/);
  assert.match(source,/DEVICE_THEME_OVERRIDE_KEY = 'zenvia-gestion-theme-device-override'/);
  assert.match(source,/safeStorageSet\('local',THEME_PREFERENCE_KEY,preferences\.theme\)/);
  assert.match(source,/safeStorageSet\('local',THEME_KEY,theme\)/);
  assert.match(source,/safeStorageSet\('local',DEVICE_THEME_OVERRIDE_KEY,next\)/);
  assert.doesNotMatch(source,/matchMedia/);
});
