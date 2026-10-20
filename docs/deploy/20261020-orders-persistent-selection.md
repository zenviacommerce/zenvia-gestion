# 2026-10-20 — Selección persistente de Pedidos

## Alcance y causa
Los cambios de filtros/página vaciaban los IDs seleccionados; seleccionar todos reemplazaba la selección y la lectura para acciones seguía aplicando los filtros visibles. Se conserva un Set por ID, con resumen permanente, revisión y eliminación individual, selección aditiva (límite 2.000), checkbox indeterminado y confirmación al incluir IDs fuera de la vista actual.

Informes y etiquetas releen y validan todos los IDs sin filtros de la vista; facturación usa la misma selección y rechaza explícitamente pedidos no facturables. Un informe guardado vacía la selección; las etiquetas eliminan solo IDs generados correctamente. Cerrar una vista previa no la vacía. Al cambiar workspace se limpia para aislar tenants.

## Evidencia previa a publicación
- Vitest: 203/203, 30 archivos. Regresión: seleccionar 3, buscar, añadir el cuarto, vista previa de 4; etiquetas y facturas completas; páginas/pestañas, uniones y confirmación cancelada.
- Build y TypeScript correctos. Suite Node local: 1.135/1.135 (integración MFA real reservada a su workflow con Supabase desechable).
- Revisión independiente: sin hallazgos críticos/importantes. Se adaptó el harness Gmail para inyectar useRef al componente compartido; sin cambios de comportamiento Gmail.
- Playwright escritorio y móvil: 14 capturas en [orders-selection-review-20261020](orders-selection-review-20261020/README.md); datos sintéticos y red bloqueada, sin compras ni informes definitivos.
- No migraciones, Edge Functions ni cambios de Auth/MFA.

## Rollback preparado
Vercel producción antes de publicar: `dpl_7SbVLnouEVmPCHEUitfutiAJ3131`, READY y alias gestion.zenviacommerce.com, commit `5563a2eb819275c46fd307c33480cd930f35459a`, bundle `index-D4U9zrKC.js`. Instant Rollback a este deployment si falla la selección. No rollback SQL necesario.

## Publicación
Pendiente de los cinco workflows requeridos en el head exacto de la PR y publicación automática de main. Se añadirá evidencia final tras verificar el deployment.
