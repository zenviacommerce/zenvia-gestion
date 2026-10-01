import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadFilters() {
  const source = await readFile(new URL('../src/services/filters.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
}

test('today preset resolves to the same from/to date', async () => {
  const { rangeForPreset } = await loadFilters();
  const now = new Date(2026, 8, 16, 12, 0, 0);
  assert.deepEqual(rangeForPreset('today', now), { from: '2026-09-16', to: '2026-09-16' });
});

test('today preset is labelled Hoy', async () => {
  const { filterForPreset, periodLabel } = await loadFilters();
  const now = new Date(2026, 8, 16, 12, 0, 0);
  assert.equal(periodLabel(filterForPreset('today', '', now), now), 'Hoy');
});


test('previous month preset resolves the full prior calendar month, including year rollover', async () => {
  const { rangeForPreset, filterForPreset, periodLabel } = await loadFilters();
  const october = new Date(2026, 9, 1, 12, 0, 0);
  assert.deepEqual(rangeForPreset('previous_month', october), { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(periodLabel(filterForPreset('previous_month', '', october), october), 'Septiembre de 2026');

  const january = new Date(2027, 0, 15, 12, 0, 0);
  assert.deepEqual(rangeForPreset('previous_month', january), { from: '2026-12-01', to: '2026-12-31' });
  assert.equal(periodLabel(filterForPreset('previous_month', '', january), january), 'Diciembre de 2026');
});

test('shared and invoice period controls expose Mes anterior', async () => {
  const [panel,invoiceFilters,settings,schema] = await Promise.all([
    readFile(new URL('../src/components/PeriodFilterPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/InvoiceFilters.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/settingsSchema.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(panel,/previous_month.*Mes anterior/s);
  assert.match(invoiceFilters,/previous_month.*Mes anterior/s);
  assert.match(settings,/previous_month.*Mes anterior/s);
  assert.match(schema,/previous_month/);
});
