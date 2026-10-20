# 2026-10-20 — Selección persistente de Pedidos

## Alcance y causa
Los cambios de filtros/página vaciaban los IDs seleccionados; seleccionar todos reemplazaba la selección y la lectura para acciones seguía aplicando los filtros visibles. Se conserva un Set por ID, con resumen permanente, revisión y eliminación individual, selección aditiva (límite 2.000), checkbox indeterminado y confirmación al incluir IDs fuera de la vista actual.

Informes y etiquetas releen y validan todos los IDs sin filtros de la vista; facturación usa la misma selección y rechaza explícitamente pedidos no facturables. Un informe guardado vacía la selección; las etiquetas eliminan solo IDs generados correctamente. Cerrar una vista previa no la vacía. Al cambiar workspace se limpia para aislar tenants.

## Evidencia previa a publicación
- Vitest: 203/203, 30 archivos. Regresión: seleccionar 3, buscar, añadir el cuarto, vista previa de 4; etiquetas y facturas completas; páginas/pestañas, uniones y confirmación cancelada.
- Build y TypeScript correctos. Suite Node completa: pendiente de resultado final al crear este diario.
- Revisión independiente: sin hallazgos críticos/importantes. Se adaptó el harness Gmail para inyectar useRef al componente compartido; sin cambios de comportamiento Gmail.
- Playwright escritorio y móvil: 14 capturas en [orders-selection-review-20261020](orders-selection-review-20261020/README.md); datos sintéticos y red bloqueada, sin compras ni informes definitivos.
- No migraciones, Edge Functions ni cambios de Auth/MFA.

## Rollback preparado
Vercel producción antes de publicar: `dpl_7SbVLnouEVmPCHEUitfutiAJ3131`, READY y alias gestion.zenviacommerce.com, commit `5563a2eb819275c46fd307c33480cd930f35459a`, bundle `index-D4U9zrKC.js`. Instant Rollback a este deployment si falla la selección. No rollback SQL necesario.

## Publicación
PR [#253](https://github.com/zenviacommerce/zenvia-gestion/pull/253), head `0586bed65a6a149ac63095c6eec1c2933cd8628f`, fusionada con expected_head_sha; merge `b2adcc7296c17f4d99bddc1e836a2b6d9117b9a4`.

Los cinco workflows success en el head exacto:
- [Build check](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39400040728): success.
- [MFA visual review (Playwright)](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39400040619): success.
- [Auth resilience tests](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39400040682): success.
- [Build ZENVIA Gestión](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39400040721): success.
- [MFA real integration (disposable Supabase)](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39400040670): success.

Vercel `dpl_CmQNujKrx5zZorn6VhvCBkkvGjnb`, READY y alias gestion.zenviacommerce.com, corresponde al merge anterior. HTML y bundle `index-SawfWbbZ.js`: HTTP 200; verificados textos de selección y confirmación fuera de vista en el JS servido.

Salud posterior (solo lectura): guard de integridad 0 hallazgos, 40 conexiones; piloto MFA enabled=true con el mismo único UUID; 0 informes de recogida. No se crearon informes definitivos ni etiquetas. Comprobación manual con sesión real pendiente del propietario.

Desviaciones: ninguna funcional; la prueba real MFA se ejecutó en CI con Supabase desechable, no contra producción. El diario final se registra en la rama de auditoría para no generar otro deployment solo por documentación.
