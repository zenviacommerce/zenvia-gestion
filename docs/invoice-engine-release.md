# Motor de integridad de facturas: preparación del despliegue

Procedimiento preparado, NO ejecutado. Requiere aprobación final. No mezclar con MFA.

## Alcance y compatibilidad

No hay migraciones ni se requieren columnas, RPC, RLS o triggers nuevos. Es código cliente:
`invoiceImportPipeline` y `repository.createInvoice` llaman a `invoiceCore` sin feature flag.
Se activa cuando un cliente carga los nuevos assets. No existe activación por cohort.
Este PR no añade ni despliega workers o Edge Functions.

El snapshot `tests/integration/schema.sql` incluye las columnas existentes: JSONB
`invoices.extraction`, `invoice_lines.line_net`, `tax_rate`, `unit`, tipos numeric y triggers.
Los nuevos campos son metadatos JSONB: `integrityCheck`, `integrityRequestedStatus`,
`lineImportWarning`, `detectedLineCount` y `unsavedLines`. La compatibilidad se prueba contra
el snapshot con PostgreSQL/PostgREST; no se han vuelto a consultar datos operativos de producción. Antes del
release, confirmar por metadatos que esas columnas y límites no han cambiado; abortar ante
deriva. NUNCA aplicar el snapshot en producción: contiene stubs y grants de pruebas.

Comprobación del 19/10/2026: consulta exclusivamente de `information_schema.columns` en
el proyecto Gestión. Las 16 columnas utilizadas y sus tipos/límites coinciden con el snapshot
(JSONB, numeric(14,2), quantity numeric(14,4), precios numeric(14,6), tax_rate numeric(7,4)
y campos text). No se leyeron facturas, proveedores, credenciales ni configuración MFA.
Esta comprobación no certifica todos los permisos/triggers; la integración aislada cubre
la estructura y persistencia, y el smoke de lectura autorizado sigue siendo una puerta del release.

## Datos sintéticos

`node scripts/generate-synthetic-invoice-fixtures.mjs` genera 82 escenarios desde cero.
No lee exportaciones, conexiones, mapas de identidades ni catálogos operativos. El nombre
histórico del JSON se conserva por compatibilidad. Los tests multifuente/Gmail también usan
muestras sintéticas. No se conserva una correspondencia de proveedores, referencias o importes.
La matriz mantiene 28 incidencias (14 altas, 5 medias, 9 bajas), siete inserciones fallidas,
duplicados, líneas ausentes, diferencias de base/precio, cantidades grandes, unidades ambiguas,
repetición legítima, servicios, retención y nueve líneas conciliadas. Los casos correctos pasan;
esto no garantiza ausencia universal de falsos positivos.

## Comportamiento, pendientes e histórico

Una discrepancia guarda `pending` con motivo y conserva líneas, sin actualizar costes/historial
mediante el nuevo guardado. Una factura correcta sigue la política configurada. Un proveedor
clasificado como `service` no requiere líneas aunque su categoría sea Mercancía. Las unidades
ambiguas o precios dudosos se excluyen de costes para revisión.

Si falla la inserción de líneas, la subida manual limpia la cabecera; Gmail puede conservarla
pendiente con aviso y `extraction.unsavedLines`. Son varias llamadas cliente con limpieza y
reintento, no una transacción global. Vigilar errores de guardado y limpieza.
`updateInvoiceStatus` no vuelve a ejecutar el motor: el cambio de estado sigue siendo explícito.
Revisar el original y corregir/reimportar líneas antes de contabilizar; no existe reparación
automática de importes, unidades o costes. Los avisos del detalle histórico se calculan en lectura:
no hay backfill ni modificación automática de registros o costes antiguos.

## Gmail en curso

Un cliente ya abierto conserva su versión. Recargar puede interrumpir un lote; no se añade
coordinación entre versiones ni pausa global. Dejar acabar los lotes antes de cambiar assets;
si no se pueden drenar, aplazar. Tras recargar, revisar estados y duplicados antes de reintentar.
No reiniciar ni desplegar procesos de seguridad/MFA.

## Fases propuestas (no ejecutar todavía)

1. Puerta de aprobación: HEAD/árbol probados y publicados idénticos, cinco workflows verdes,
   sin conflictos y revisión de privacidad. Un force push no purga objetos antiguos, cachés,
   forks o clones: si siguen accesibles por SHA, registrar y solicitar retirada a GitHub.
2. Preview: acceso oficial autorizado y destino de datos confirmado como aislado ANTES de
   escribir. Si apunta a producción o no se conoce, solo lectura. Probar login, PDF sintético,
   factura válida, duplicados, diferencias de líneas/IVA, revisión, guardado, errores y diseño.
   Gmail se prueba con mocks en integración; OAuth/lector real es una puerta distinta.
3. Preparación: confirmar esquema por metadatos, drenar Gmail y registrar SHA/deployment previo.
   Sin migraciones ni cambios de configuración MFA.
4. Solo tras aprobación separada: publicar assets revisados, comprobar versión en un cliente y
   después recargar el resto. No hay piloto por flag; ensayarlo antes en preview aislado.
5. Observar estados/avisos de importaciones legítimas y errores. No crear facturas sintéticas
   en producción. Detener ante pérdida de líneas, duplicados o costes indebidos.

## Comprobación rápida

Ejecutar el job reproducible `invoice-import-integration` de `.github/workflows/build.yml`
con PostgreSQL/PostgREST desechables: sus 13 casos usan supabase-js real, lector/Gmail simulados,
persistencia, costes, discrepancias, errores e histórico intacto. Nunca usar URLs/credenciales
de producción para `ZG_IT_*`.

```sh
node --test scripts/invoice-fixture-privacy.test.mjs scripts/invoice-historical-regression.test.mjs scripts/invoice-integrity-engine.test.mjs
npx tsc -b
npm run build
# Base local creada siguiendo tests/integration/README.md:
ZG_IT_PGRST=http://127.0.0.1:3000 ZG_IT_JWT_SECRET=<secreto-local-desechable> ZG_IT_PSQL="psql -d zvit" npx vitest run tests/invoice-import.integration.test.ts
```

Auth, Storage y lectura PDF se simulan en esa integración: no sustituye el flujo del navegador,
la extracción de un PDF real ni OAuth Gmail. En producción, el smoke es solo lectura: abrir un
detalle existente y comprobar avisos sin guardar, reprocesar o cambiar estados.

## Rollback

Registrar el deployment anterior antes del release. Restaurarlo mediante Vercel solo si NO
deshace otros cambios posteriores, especialmente MFA. Si los contiene, preparar un rollback
que revierta únicamente el diff del motor sobre el main vigente, ensayarlo y aprobarlo antes
de publicarlo. No revertir una versión completa con otros desarrollos. No hay rollback SQL.
Restaurar assets NO revierte facturas, proveedores, productos ni costes ya escritos. Las facturas
pendientes y el JSON adicional son compatibles con la versión previa; revisarlas manualmente.
No borrar/reimportar masivamente. Cualquier corrección de costes requiere investigación y una
actuación de datos independiente. Recargar clientes sin lotes activos y comprobar lectura/estados.

## Límites de validación preview

La conexión Vercel devolvió 403 en `read_protection_bypass` y 404 en metadatos del deployment.
Indica falta de autorización de la conexión para ese recurso; no demuestra fallo del login de
la aplicación ni un problema SSO del usuario. El CLI local no tiene credenciales existentes.
No se ha cambiado Deployment Protection. Sin acceso no se confirmó la base de preview ni se
probaron allí login, PDF, guardado o diseño. CI y tests aislados son pruebas alternativas,
no una validación funcional de esa URL.
