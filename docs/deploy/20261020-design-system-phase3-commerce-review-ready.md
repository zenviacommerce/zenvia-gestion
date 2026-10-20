# Fase 3 · lote 2 listo para revisión — NO PUBLICADO

[PR #266](https://github.com/zenviacommerce/zenvia-gestion/pull/266), borrador sin fusionar. Commit probado `3c109bb45b5c4559ce9b73dd9e5964b08e4f50b4`, árbol `0d55f30c5f1b6f3b5af45af3523d8b3565cffc50`.

## CI completa

- [Vercel Preview Comments](https://github.com/zenviacommerce/zenvia-gestion/runs/118853805648): success, 2026-10-20T19:59:25Z
- [screenshots](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39488037221/job/118853503777): success, 2026-10-20T20:02:20Z
- [build](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39488037508/job/118853503705): success, 2026-10-20T20:00:21Z
- [build](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39488037264/job/118853503435): success, 2026-10-20T19:59:40Z
- [auth-tests](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39488037074/job/118853503234): success, 2026-10-20T20:00:33Z
- [real-auth-vault](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39488037276/job/118853502991): success, 2026-10-20T20:02:46Z

Vercel commit status: success. Local: 250 Vitest en 47 ficheros y 1222 Node, build y contrato pasan. Seis capturas antes y seis después de Resumen, más Productos y segundo pantallazo móvil. Comparaciones sin fallos de cinco tarjetas, cifras, variantes, botones, tabs, fila de producto y filtros en una línea. Galería con alturas: design-phase3-commerce-20261020/README.md.

Revisión independiente: sin hallazgos críticos/importantes; asociación tab/panel corregida y verificada de nuevo. Nueve componentes/servicios idénticos; hooks/callbacks sin cambios, según source-parity.json. Pruebas de refresco y Actualizar datos ejecutadas contra fixtures, sin consultar tiendas. No equivale a revisión visual autenticada del propietario.

## Producción y rollback

Lote 1 sigue en main `0d34847a567b7baf4ffeb54fba1c97ffa4a176d6`, deployment `dpl_Aso26hWc9uXcmmcC5ppWpcMJFFys` READY, bundle `index-e22tGZwY.js`. HTML y CSS HTTP200; CSS `index-D4g81wg0.css` contiene la regla global del KPI impar móvil. Ese deployment es rollback preparado para una publicación futura autorizada del lote 2. No se ejecuta rollback y no cambia ningún dato ni configuración de producción.

Recibo completo en design-phase3-commerce-20261020/ci-receipt.json. Se guarda en rama solo documental separada para conservar el commit probado de la PR. **DETENIDO antes de fusionar o publicar #266.**
