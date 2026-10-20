# Fase 3 · lote 1 publicado

El propietario aprobó #265 y autorizó publicar con el retoque global del KPI impar. CI completa en verde sobre `002b953d804c5b56cb6d566aa37b96bbeeb0d43c`; merge `0d34847a567b7baf4ffeb54fba1c97ffa4a176d6`.

- Producción: https://gestion.zenviacommerce.com — HTTP 200.
- Deployment `dpl_Aso26hWc9uXcmmcC5ppWpcMJFFys`: READY, target production, commit exacto del merge.
- Bundle servido: `index-e22tGZwY.js`.
- Retoque: última StatCard impar ocupa ambas columnas en móvil. Test de navegador falla sin la regla y pasa con ella. Nueve escenarios de maestros pasan; cifras, variantes y acciones conservadas.
- Verificación visual del propietario en producción pendiente; no se declara hecha con HTTP/API.

## CI del commit publicado

- [Vercel Preview Comments](https://github.com/zenviacommerce/zenvia-gestion/runs/118847481780): success, 2026-10-20T19:46:28Z
- [build](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39486238076/job/118847258050): success, 2026-10-20T19:46:39Z
- [build](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39486238069/job/118847257730): success, 2026-10-20T19:47:07Z
- [real-auth-vault](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39486237622/job/118847256809): success, 2026-10-20T19:50:18Z
- [auth-tests](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39486237151/job/118847254576): success, 2026-10-20T19:47:51Z
- [screenshots](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39486237149/job/118847254070): success, 2026-10-20T19:49:13Z

## Rollback preparado antes del merge, sin ejecutar

Restaurar `dpl_9RMFEKn4AhoTo738mzvfBbdqCURS`, commit `ed63ce7aecff7c7a296b5fface372f89ee4b8bf7`, bundle `index-DlLrR06h.js`; comprobar alias y sesión. Alternativa revertir merge #265 por PR y CI. No hay cambios de datos, Edge ni Auth.

Recibo guardado en rama solo documental, sin tocar main ni provocar otra publicación. Amazon/Shopify se preparan en lote 2 separado, pendiente de revisión antes de publicar.
