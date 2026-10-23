# #299 — caché aplicada, frontend retenido

Autorización explícita del propietario: relleno de 1.011 filas/2 owners, lock_timeout 3 s, statement_timeout 15 s y rollback preparado. Aplicado el 23/10/2026 a las 20:51:22 CEST (18:51:22 UTC), migración de producción `20261023185119_orders_299_approved_cache_backfill`.

## Recibo real

- Relleno: 1.011 filas en **423,194 ms** medidos dentro de PostgreSQL con clock_timestamp.
- Tiempo de servidor hasta completar SQL/medición: **2.348,503 ms**. Llamada completa a la API de migración: 3.105 ms, incluida comunicación.
- Después: 1.011 filas, 2 owners, 0 fragmentos ausentes; RLS activada y sin grants al cliente sobre tabla privada.
- Migración exitosa, sin errores ni timeouts. Cero sesiones esperando Lock en las comprobaciones previa y posterior. Cero mensajes de bloqueo/timeout en logs del intervalo 18:51:17–18:51:25 UTC. Esto acredita ausencia de esperas registradas; no mide toda espera interna inferior al umbral de logging.
- Cobertura MFA: private.mfa_activation_findings() devuelve 0 hallazgos antes y después. Configuración y estado del piloto intactos.

`applied.sql` conserva el SQL ejecutado: parte de caché/RPC de la propuesta, con medición del backfill guardada en COMMENT de la tabla. Se aplazó exclusivamente la nueva API pública orders_operational_summary_v1: CI real-auth-vault detectó que necesita incorporarse correctamente al inventario de wrappers antes del frontend. No se cambió la configuración MFA para esquivar ese hallazgo. La tabla y dos RPC ya benefician al frontend publicado; la API de Resumen no se usa todavía en producción.

## Verificación posterior

Rol authenticated, owner real y contexto AAL2 de sesión vigente, sin registrar identificadores de sesión/tokens; límite 8 s. Lecturas aisladas (NO medición concurrente): Workbench Pendientes 173,363 ms y 2 filas; Pickup Pendientes 135,358 ms y 2 filas; Workbench Enviados 156,841 ms/25 filas; Pickup Enviados 245,008 ms/25 filas. Logistics con los 1.023 pedidos visibles al owner: 122,791 ms. Contadores Workbench 2 / 0 / 943 / 9 / 64 idénticos a la recuperación confirmada.

Navegador real recargado tras SQL: Pendientes carga 2 pedidos. Enviados conserva preferencia de página de 20: 179 expedidos en trimestre actual y 943 en Todo. Cancelados 7 para ese trimestre, 64 en Todo; la diferencia depende del filtro y no es un cambio de clasificación. Se comprobaron ambas vistas y se restauró el trimestre actual y la pestaña Pendientes. Capturas de cabecera/counters sin datos de compradores, entregadas al propietario.

**Aceptación de <300 ms pendiente del propietario con las llamadas concurrentes reales.** Nunca sustituir esa medida por consultas separadas. Frontend #299 sin publicar, a la espera de esta aceptación, capturas y autorización de publicación.

Rollback exacto preparado: `supabase/rollback/20261023_orders_cached_logistics_read.sql`. Restaura las dos RPC al estado recuperado; conserva logistics set-based y datos derivados, deshabilita el nuevo trigger. No se ejecutó porque las verificaciones posteriores fueron correctas.

## Cierre MFA y publicación autorizada

El propietario autoriza publicar #299 tras cerrar MFA y CI, sin autenticar en preview. Migración aditiva `20261023214651_orders_operational_summary_mfa` aplicada: wrapper público registrado y hash vigente, implementación privada sin EXECUTE de authenticated y endpoint público sin EXECUTE de anon; 0 hallazgos MFA. La configuración del piloto no se modifica. Validación autenticada/AAL2 del propietario: orders=945, pending=2, shipped=943, cancelled=64, amazon=929, shopify=16. Las pruebas locales de SQL/frontend pasan 38/38; contratos Node 11/11. Los nombres del repositorio se alinean con el historial real de producción: el relleno ya aplicado no debe repetirse.

### Rollback operativo

- Frontend: Vercel > despliegue `6No63ukSk9iouYZtXh1UTDA2xuNC` > Deployment Actions > Instant Rollback. SHA `6ef863cf69a8e570a195d6438f8c07d8eff97e52`, dominio inmutable `zenvia-gestion-4ycn7ykvo-sergiorojasdiaz-7097.vercel.app`. Acceso confirmado en la sesión existente; actualmente figura Current y por eso Instant Rollback está deshabilitado. Tras publicar el nuevo despliegue, este será el destino anterior, sin reconstruir assets.
- RPC: ejecutar `supabase/rollback/20261023_orders_cached_logistics_read.sql` en producción. Restaura las funciones recuperadas y desactiva el trigger de caché sin borrar datos; mantiene la logística set-based y la nueva API de resumen para compatibilidad. Archivo completo preparado para ejecución directa.
- Si falla únicamente la instalación de la API antes de publicar frontend: `rollback-summary-api.sql` revierte solo sus dos funciones y su entrada de manifiesto. No usar con el frontend nuevo activo.
- Disparador autorizado: cualquier llamada sostenida >300 ms en las tres pestañas reales, o regresión de contadores, filas o selección. Ejecutar rollback de frontend y RPC inmediatamente.
- La aceptación de rendimiento requiere el navegador real del propietario y llamadas concurrentes; tiempos SQL aislados no demuestran ese objetivo.

Frontend todavía sin publicar en este punto del diario; pendiente CI final y despliegue main.
