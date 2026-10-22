# B · preflight de producción

Autorización explícita del propietario: publicar A y B por separado después de ajustes y CI verde. Aún no aplicado SQL ni Edge de B.

Snapshot fresco: supabase/snapshots/20261023-pickup-before-production.json. Recuento:3informes,0históricos mixtos,0bucket pickup-report-documents,configuración nueva ausente. Se guardaron3definiciones existentes y la fila del manifiesto. No se leyó PII de conductores.

## Actualización de metadatos
La última migración extiende los filtros validados del wrapper; registra su nueva huella. Afecta exactamente1fila técnica, function_oid3869302 (orders_dashboard_pickup_v1 de18argumentos), hash previo4a5d7ee5c3d93eb71e22f4b51f7a2e63. No modifica el piloto ni reglas MFA. SQL exacto del bloque:
```sql
v_oid:='public.orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure;
update private.mfa_function_manifest set wrapper_hash=md5(pg_get_functiondef(v_oid)) where function_oid=v_oid;
```
El bloque completo está en supabase/migrations/20261022203400_pickup_document_membership.sql. No hay DELETE/DROP ni UPDATE de pedidos/informes existentes en la instalación. Las escrituras internas de firma/correo/purga se definen en funciones pero no se ejecutan al migrar.

## Edge y MFA
Nuevo pickup-report-documents JWTtrue; nuevo pickup-report-purge JWTfalse con requireInternalSecret, sin cron. Dependencias MFA copiadas del bundle vigente mrw-shipping25 (snapshot fresco), manteniendo exactamente mfa.ts y mfa-policy.ts de producción. El código bridge del repositorio difiere del desplegado y no se introduce. No se sustituye ninguna función existente. Bundle compuesto y typecheck Deno2.9.6 correctos; hashes en20261023-pickup-production-bundle.json. No se invoca el purgador.

## Rollback
Antes de cualquier firma, devolver el frontend al despliegue A si hiciera falta. Después de una firma, conservar lector B y PDF definitivo; aplicar rollback operativo de solo lectura supabase/rollback/20261022_pickup_document_read_only.sql. Revoca nuevas escrituras y correo, conserva auditoría y recibos en curso. No borrar tablas, documentos ni DNI/firma como rollback. Retención365d; no activar purga sin recuento y autorización.
