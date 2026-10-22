import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('bulk label generation is not disabled by background sync or status health checks',async()=>{
  const source=await read('../src/pages/Orders.tsx');
  const pendingAction=source.match(/<button[^>]*onClick=\{\(\)=>void generateConfiguredLabels\(true\)\}[^>]*>/)?.[0];
  const selectedAction=source.match(/<button[^>]*onClick=\{\(\)=>void generateSelectedLabels\(\)\}[^>]*>/)?.[0];
  assert.ok(pendingAction,'Pending workbench keeps its all-pending label action');
  assert.ok(selectedAction,'Selection toolbar keeps its selected-label action');
  assert.match(pendingAction,/disabled=\{bulkGenerating\|\|selectionBusy\|\|loading\|\|\(dashboardKpis\?\.preparablePending/);
  assert.match(selectedAction,/!selectedCount\|\|!labelSelectionAllowed\|\|bulkGenerating\|\|selectionBusy\|\|loading/);
  for(const action of [pendingAction,selectedAction])assert.doesNotMatch(action,/syncing|status\?\.configured|enviaStatus/);
  assert.match(source,/disabled=\{!selectedCount\|\|bulkGenerating\|\|selectionBusy\|\|loading\}/);
  assert.doesNotMatch(source,/disabled=\{bulkGenerating\|\|syncing\|\|!status\?\.configured\|\|configuredBulkTargets\.length===0\}/);
  assert.doesNotMatch(source,/disabled=\{!selectedOrders\.length\|\|bulkGenerating\|\|syncing\|\|!status\?\.configured\}/);
});

test('direct printing remains optional with ZENVIA Print Agent and PDF fallback',async()=>{
  const source=await read('../src/pages/Orders.tsx');
  assert.match(source,/Impresión directa/);
  assert.match(source,/Impresión opcional con ZENVIA Print Agent; las etiquetas también se pueden descargar/);
  assert.match(source,/onClick=\{detectPrinters\}/);
  assert.match(source,/Usar PDF/);
  assert.match(source,/showInfo\('La impresión directa requiere ZENVIA Print Agent/);
});

test('toast system supports neutral informational messages',async()=>{
  const service=await read('../src/services/toast.ts');
  const host=await read('../src/components/ToastHost.tsx');
  const css=await read('../src/toast.css');
  assert.match(service,/ToastKind = 'success' \| 'error' \| 'info'/);
  assert.match(service,/export function showInfo/);
  assert.match(host,/item\.kind === 'info'/);
  assert.match(css,/\.appToast\.info/);
});

test('generating all pending labels requires the standard application confirmation dialog',async()=>{
  const source=await read('../src/pages/Orders.tsx');
  assert.match(source,/import \{ confirmAction \} from '\.\.\/services\/actionDialog'/);
  assert.match(source,/title:'Generar todas las etiquetas pendientes'/);
  assert.match(source,/confirmLabel:'Generar etiquetas'/);
  assert.match(source,/tone:'warning'/);
  assert.match(source,/if\(!confirmed\)return/);
});


test('pending and labelled order queues are operational and ignore global period boundaries',async()=>{
  const source=await read('../src/pages/Orders.tsx');
  assert.match(source,/const operationalContextOrders=useMemo\(\(\)=>orders\.filter/);
  assert.match(source,/const labelContextOrders=useMemo\(\(\)=>operationalContextOrders\.filter\(isLabelledOrder\)/);
  assert.match(source,/const pendingOrders=useMemo\(\(\)=>operationalContextOrders\.filter\(isPendingOrder\)/);
  assert.match(source,/const dateFrom=ordersTabUsesPeriod\(activeTab\)\?dateFilter\.from:'',dateTo=ordersTabUsesPeriod\(activeTab\)\?dateFilter\.to:''/);
  const routing=await read('../src/services/ordersWorkbench.ts');
  assert.match(routing,/ordersTabUsesPeriod\(tab:OrdersTab\)\{return tab==='shipped'\|\|tab==='cancelled'\}/);
  assert.doesNotMatch(source,/labelPeriodOrders/);
});


test('Orders tracks whether a generated label has been printed from ZENVIA',async()=>{
  const [page,service,stateEdge,migration]=await Promise.all([
    read('../src/pages/Orders.tsx'),
    read('../src/services/orders.ts'),
    read('../supabase/functions/order-logistics-state/index.ts'),
    read('../supabase/migrations/20261001103000_order_package_and_print_state.sql'),
  ]);
  assert.match(page,/Impresión/);
  assert.match(page,/No impreso/);
  assert.match(page,/markOrderLabelPrinted/);
  assert.match(service,/labelPrintedAt/);
  assert.match(service,/labelPrintCount/);
  assert.match(stateEdge,/mark_label_printed/);
  assert.match(migration,/label_printed_at/);
  assert.match(migration,/label_print_count/);
});


test('historical labels without tracked print evidence show as unknown, not unprinted',async()=>{
  const [page,service,migration,stateEdge]=await Promise.all([
    read('../src/pages/Orders.tsx'),
    read('../src/services/orders.ts'),
    read('../supabase/migrations/20261001111500_label_print_history_known_state.sql'),
    read('../supabase/functions/order-logistics-state/index.ts'),
  ]);
  assert.match(service,/labelPrintStateKnown:boolean/);
  assert.match(page,/Sin información/);
  assert.match(page,/Sin información histórica/);
  assert.match(page,/labelPrintState\(order\)/);
  assert.match(migration,/label_print_state_known=false/);
  assert.match(migration,/403-5230881-6173918/);
  assert.match(stateEdge,/label_print_state_known:true/);
});
