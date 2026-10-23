# Shipping reconciliation release

Owner explicitly approved PR298 including active worker max5/run. Base main5db28e2, reviewed PR head882456e5 with7checks successful(all6CI workflows). Preflight17:56:58UTC0CREATING/0live leases; durable table absent. No bulk repair. Install paused, deploy5functions, schedule paused, activate with fresh guard, then UI. Rollback pause control+cron; preserve guarded handlers if operations open. Exact prior3Edge snapshots saved adjacent; downgrade requires0open/0CREATING. Preserve emergency RPC patches. No real shipment/invoice/email tests.


## Publicación verificada

23/10/2026, merge main `6ef863cf69a8e570a195d6438f8c07d8eff97e52` (#298). Migración instalada inicialmente con control apagado; handlers desplegados: shipping-creation-reconcile v1 (verify_jwt=true), shipping-creation-worker v1 (verify_jwt=false, requireInternalSecret), mrw-shipping v28, envia-shipping v47, sendcloud-orders v37. Cron 63 `zenvia-shipping-creation-reconcile`, cada minuto, activo; control enabled=true; máximo 5 por ronda en código. Preflight de activación 18:09:01 UTC: 0 CREATING, 0 operaciones abiertas, 0 leases vivos. Primera ejecución 18:10:00 UTC exitosa; dos respuestas HTTP 200 con processed=0 y sin error. No se prueba creando envíos reales. Vercel reportó success para el merge.

Rollback documentado en `supabase/rollback/20261023_shipping_creation_reconciliation.sql`: apagar primero control y cron; no degradar handlers con operaciones abiertas. Conservar datos y snapshots previos de las tres funciones de transportistas.

Lección obligatoria de la incidencia Pedidos: verificar SIEMPRE en el navegador real del propietario con las llamadas concurrentes, no solo por separado. Recuperación medida por el propietario: Pendientes pickup 748 ms / workbench 1.029 ms / logistics 427 ms; Enviados 667 / 790 / 491 ms. Contadores 2 / 0 / 943 / 9 / 64 correctos. #299 exige <300 ms en concurrencia real; no se declara alcanzado por estas cifras.
