# 2026-10-20 — Informes visibles, checkbox fijo y sello

## Estado
PR preparada para revisión. NO publicar frontend ni aplicar migraciones hasta revisión del propietario. Producción sigue en PR253, commit b2adcc7296c17f4d99bddc1e836a2b6d9117b9a4, bundle index-SawfWbbZ.js.

## Cambios
- RPC aditiva orders_dashboard_pickup_v1: números REC en página, filtro Todos / Sin informe / En informe antes de paginar y seleccionar todos. Usa índices existentes de items por owner/order y owner/key; una llamada de página, sin N+1. Canonicaliza con la misma clave lógica que informes. API anterior intacta.
- Columna REC en tabla y etiqueta en tarjetas; abren historial del pedido para reimpresión. Detalle conserva su sección Recogida. Cambiar filtro conserva IDs seleccionados; relectura de selección neutraliza filtro REC.
- Sticky izquierdo para checkbox en las siete tablas con selección (Pedidos, Facturas, facturas de ventas, Recibos, Productos, Clientes y Proveedores), fondo opaco, sombra, selected/hover, temas claro/oscuro y capa de cabecera. Número de pedido no se fija: aparece después de Canal y no se fuerzan anchos/offsets que alteren móvil. Tarjetas móviles conservan checkbox sin scroll horizontal.
- General: sello separado del logo, PNG/JPG, máximo 5 MB, imagen en company-assets por owner del workspace; recorte de papel y bordes neutros, blanco transparente y conservación de tinta de color. PDF: sello proporcional solo en recuadro del remitente; conductor vacío. Sin sello o descarga inválida: recuadro vacío y PDF imprimible.

## Seguridad y revisión
Nueva RPC con owner explícito, permisos Orders y MFA mediante wrapper incluido en el manifiesto de integridad; implementación privada sin grants a clientes. No cambios de configuración Auth/MFA.
Sello: políticas restrictivas adicionales impiden que los permisos antiguos de Ventas permitan sobrescribir, renombrar hacia el namespace del sello o borrarlo. Miembros solo Orders resuelven owner por filas con RLS; primer upload sin branding usa app_users.data_owner_id, nunca el UID del miembro como owner supuesto.
Revisión independiente inicial encontró ambos casos de sello; corregidos con regresiones. Segunda revisión: sin hallazgos importantes, 4 archivos /10 tests independientes verdes.

## Evidencia
- Vitest: 216/216, 35 archivos. SQL real PostgreSQL WASM: filtro previo a página/IDs, MFA/tenant, manifiesto y rollback; sello con políticas antiguas permisivas y gates restrictivos; carga de branding de miembros y primer upload.
- Prueba Chromium sticky: 16 combinaciones de viewport, tema y tipo de tabla, click tras scroll horizontal y capas con cabecera vertical.
- Galería: [capturas y PDF](pickup-enhancements-review-20261020/README.md). Fixture sintética con red bloqueada. Eliminación de sello comprobada sin eliminar logo. No datos de compradores reales.
- Baseline leído de producción: guard MFA 0; MD5 dashboard original 081c0519b77e14fd53598cefba39aeb7; scope privado 943ab6c033c812a159a52d0737df80dc. Este último coincide exactamente con el ejecutado en la prueba SQL de la nueva migración.
- Suite Node: 1.135/1.135. TypeScript y build correctos. Los cinco workflows se registrarán tras terminar CI del head exacto.

## Publicación futura, solo después de revisión
1. Tomar snapshot pg_get_functiondef de ambos dashboards existentes, manifiesto MFA, políticas Storage/company_branding y metadatos de branding. No copiar credenciales. Registrar deployment de Vercel actual para Instant Rollback.
2. Aplicar 20261020095712_pickup_dashboard_membership y 20261020095715_company_stamp. Comprobar guard 0, AAL1/AAL2/cohort conforme, separación de workspaces y filtros/paginación/selección. Ninguna etiqueta ni informe definitivo necesario.
3. Publicar frontend y verificar lista, detalle, filtro y PDF de vista de pruebas sin registrar informe definitivo.

## Rollback
Primero Instant Rollback al deployment anterior registrado justo antes de publicar. Después scripts supabase/rollback/20261020_company_stamp.sql y 20261020_pickup_dashboard_membership.sql (probados en DB aislada). La RPC anterior se conserva sin modificaciones. Antes de quitar stamp_path, respaldar owner_id/stamp_path si alguien subió sello; Storage conserva los objetos. No borrar informes existentes.
