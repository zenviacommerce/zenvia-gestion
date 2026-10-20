# Fase 3 · lote 1 listo para revisión, sin publicar

PR [#265](https://github.com/zenviacommerce/zenvia-gestion/pull/265), borrador sin fusionar. Commit comprobado `5291d2a12bb42fba53adc2705abb4a0afc912557`, árbol `fa91af65fed90159d85db70c5175f951c43fe1d9`.

## CI del commit final

- [Vercel Preview Comments](https://github.com/zenviacommerce/zenvia-gestion/runs/118842629613): success, 2026-10-20T19:36:26Z
- [build](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39484799679/job/118842307918): success, 2026-10-20T19:36:41Z
- [screenshots](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39484799480/job/118842307528): success, 2026-10-20T19:39:06Z
- [auth-tests](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39484799074/job/118842306889): success, 2026-10-20T19:37:36Z
- [real-auth-vault](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39484799118/job/118842306393): success, 2026-10-20T19:39:44Z
- [build](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39484799130/job/118842306366): success, 2026-10-20T19:37:42Z

Estado Vercel: success. Recibo completo en `design-phase3-masters-20261020/ci-receipt.json`.

## Evidencia y límites

Productos, Clientes y Proveedores: antes/después a 390/1280/1440, nueve escenarios sin fallos; reflow 640 en las tres pantallas; modo oscuro y segundo pantallazo móvil. Altura móvil: Productos 1855,1 → 1148,5 px; Clientes 1590,2 → 1057,7 px; Proveedores 1475,2 → 1044,7 px. Medición inmediatamente antes de la captura. Equilibrio común de KPI: siete en 4 + 3, móvil dos columnas; capturas a 1568/1920 de pantallas financieras. Acciones, etiquetas de opciones, variantes y selección comprobadas. Suite local: 249 Vitest (46 ficheros), 1222 Node; build y contrato pasan. Revisión independiente con seguimiento sin hallazgos pendientes.

Datos sintéticos y red bloqueada: no es validación visual del propietario sobre producción. No se guardan datos. Editor interno de Clientes conservado por diff. Paginación de cliente sin cambios. El timeout local con Chromium simultáneo y su repetición íntegra en verde se documentan en el diario del lote.

## Producción y rollback

Producción y main permanecen en `ed63ce7aecff7c7a296b5fface372f89ee4b8bf7`, deployment READY `dpl_9RMFEKn4AhoTo738mzvfBbdqCURS`, bundle `index-DlLrR06h.js`. Ese deployment es el rollback preparado si se autoriza la publicación futura; no se ejecuta ahora. No hay cambios SQL, Edge ni Auth en este lote.

Este recibo se guarda en rama solo documental separada para no mover el commit probado de la PR. **DETENIDO antes de fusionar/publicar; pendiente de revisión del propietario.**
