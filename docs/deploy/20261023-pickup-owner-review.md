# B · ajustes aprobados del propietario

## Cambios
Copia al propietario marcada por defecto debajo de Destinatario, con email real del propietario del workspace. Nueva consulta owner_email: valida acceso al informe con pickup_document_read y scope MFA/tenant antes de consultar Auth admin; nunca se usa el email del actor. Si la consulta falla se permite desmarcar y enviar sin copia; el historial se conserva independientemente. No se registra el email ni la firma en logs.

FormModal compartido verde de marca. Firma a390×844CSSpx con entradas16px para evitar zoom iOS, etiquetas13px, distribución en dos columnas y canvas ajustado al viewport; backing store retina3×. Comprobaciones por pointer touch: canvas completo dentro de viewport, scroll página/modal idéntico antes/después del trazo, sin overflow. Capturas se guardan en escala CSS para revisión sin ampliación aparente; la imagen de firma conserva su resolución retina. Calendario compacto mantiene nombre accesible y es-ES.

## Validación
Suite completa previa al caso adicional de recuperación:627/627,114archivos. Nuevo caso de recuperación16/16 focales. Deno2.9.6 check de ambas funciones correcto. Build correcto (advertencia histórica chunks>500kB). Revisión independiente detectó el caso de recuperación y se corrigió con prueba roja y verde. No se han creado informes ni correos reales.

## Producción y rollback
B no se publica hasta publicar/verificar A y pasar CI final. Migraciones preparadas y revisadas; hay3informes históricos en producción, sin cambios. Purga desactivada por defecto y sin cron activo; retención365d configurable. Nunca activar sin recuento previo mostrado al propietario.

Rollback operativo preparado en supabase/rollback/20261022_pickup_document_read_only.sql: desactiva escrituras/firma/correo nuevo, conserva documentos, auditoría, lectura y PDFs firmados. Si ya existen firmas no regresar al antiguo renderer que podría ofrecer PDF sin firma. Base frontend a registrar al publicar A.

La migración de pertenencia actualiza1fila técnica de private.mfa_function_manifest (wrapper_hash de orders_dashboard_pickup_v1); no modifica datos de pedidos/informes, ni el piloto MFA. Recuento previo1, hash previo4a5d7ee5c3d93eb71e22f4b51f7a2e63. Guardar snapshot de definición/manifest antes de aplicar.

SQL exacto dentro del bloque (v_oid es el regprocedure público de18argumentos de la misma migración):
```sql
update private.mfa_function_manifest
set wrapper_hash=md5(pg_get_functiondef(v_oid))
where function_oid=v_oid;
```

## Galería de ajustes

| Pantalla | Ancho/tema | Antes aprobado | Después |
|---|---|---|---|
| create | 390 light | [Antes](20261023-pickup-owner-before/after-create-390-light.png) | [Después](20261023-pickup-owner-after/after-create-390-light.png) |
| create | 390 dark | [Antes](20261023-pickup-owner-before/after-create-390-dark.png) | [Después](20261023-pickup-owner-after/after-create-390-dark.png) |
| create | 1280 light | [Antes](20261023-pickup-owner-before/after-create-1280-light.png) | [Después](20261023-pickup-owner-after/after-create-1280-light.png) |
| create | 1280 dark | [Antes](20261023-pickup-owner-before/after-create-1280-dark.png) | [Después](20261023-pickup-owner-after/after-create-1280-dark.png) |
| create | 1440 light | [Antes](20261023-pickup-owner-before/after-create-1440-light.png) | [Después](20261023-pickup-owner-after/after-create-1440-light.png) |
| create | 1440 dark | [Antes](20261023-pickup-owner-before/after-create-1440-dark.png) | [Después](20261023-pickup-owner-after/after-create-1440-dark.png) |
| pending | 390 light | [Antes](20261023-pickup-owner-before/after-pending-390-light.png) | [Después](20261023-pickup-owner-after/after-pending-390-light.png) |
| pending | 390 dark | [Antes](20261023-pickup-owner-before/after-pending-390-dark.png) | [Después](20261023-pickup-owner-after/after-pending-390-dark.png) |
| pending | 1280 light | [Antes](20261023-pickup-owner-before/after-pending-1280-light.png) | [Después](20261023-pickup-owner-after/after-pending-1280-light.png) |
| pending | 1280 dark | [Antes](20261023-pickup-owner-before/after-pending-1280-dark.png) | [Después](20261023-pickup-owner-after/after-pending-1280-dark.png) |
| pending | 1440 light | [Antes](20261023-pickup-owner-before/after-pending-1440-light.png) | [Después](20261023-pickup-owner-after/after-pending-1440-light.png) |
| pending | 1440 dark | [Antes](20261023-pickup-owner-before/after-pending-1440-dark.png) | [Después](20261023-pickup-owner-after/after-pending-1440-dark.png) |
| signature | 390 light | [Antes](20261023-pickup-owner-before/after-signature-390-light.png) | [Después](20261023-pickup-owner-after/after-signature-390-light.png) |
| signature | 390 dark | [Antes](20261023-pickup-owner-before/after-signature-390-dark.png) | [Después](20261023-pickup-owner-after/after-signature-390-dark.png) |
| signature | 1280 light | [Antes](20261023-pickup-owner-before/after-signature-1280-light.png) | [Después](20261023-pickup-owner-after/after-signature-1280-light.png) |
| signature | 1280 dark | [Antes](20261023-pickup-owner-before/after-signature-1280-dark.png) | [Después](20261023-pickup-owner-after/after-signature-1280-dark.png) |
| signature | 1440 light | [Antes](20261023-pickup-owner-before/after-signature-1440-light.png) | [Después](20261023-pickup-owner-after/after-signature-1440-light.png) |
| signature | 1440 dark | [Antes](20261023-pickup-owner-before/after-signature-1440-dark.png) | [Después](20261023-pickup-owner-after/after-signature-1440-dark.png) |
| email | 390 light | [Antes](20261023-pickup-owner-before/after-email-390-light.png) | [Después](20261023-pickup-owner-after/after-email-390-light.png) |
| email | 390 dark | [Antes](20261023-pickup-owner-before/after-email-390-dark.png) | [Después](20261023-pickup-owner-after/after-email-390-dark.png) |
| email | 1280 light | [Antes](20261023-pickup-owner-before/after-email-1280-light.png) | [Después](20261023-pickup-owner-after/after-email-1280-light.png) |
| email | 1280 dark | [Antes](20261023-pickup-owner-before/after-email-1280-dark.png) | [Después](20261023-pickup-owner-after/after-email-1280-dark.png) |
| email | 1440 light | [Antes](20261023-pickup-owner-before/after-email-1440-light.png) | [Después](20261023-pickup-owner-after/after-email-1440-light.png) |
| email | 1440 dark | [Antes](20261023-pickup-owner-before/after-email-1440-dark.png) | [Después](20261023-pickup-owner-after/after-email-1440-dark.png) |

Firma con dedo: [390 claro](20261023-pickup-owner-after/after-finger-390-light.png), [390 oscuro](20261023-pickup-owner-after/after-finger-390-dark.png). Los manifest contienen medidas CSS/retina y hashes.
