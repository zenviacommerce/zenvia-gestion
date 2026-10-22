# Revisión aprobada y publicación — 22/10/2026

## Autorización y alcance

El propietario aprueba la galería y autoriza publicar tras: cabecera en una fila, seguimiento prioritario en Incidencias, revisión de fechas es-ES y CI verde. Se aplica también la prioridad de seguimiento a Enviados. Registrar envío externo sigue después de este despliegue.

## Recuperación del estado

- PR #284, abierta en borrador; rama `feat/orders-workbench-review`, SHA `78e54a8b713bfd21a525d4449c3db5a773cdbad2`.
- Los seis workflows de ese SHA terminan correctamente; la X observada correspondía a un intento anterior ya corregido.
- Producción confirmada en Vercel: `dpl_usywB96ezEmZNWpSNGqPK7r1wFeG`, URL `zenvia-gestion-p6dwq138c-sergiorojasdiaz-7097.vercel.app`, commit `21622348044745dd54978f69ac80f39321f39533`, estado READY.

## Ajustes y evidencia

- Nuevo pedido, Actualizar y Más acciones ocupan una fila. Tarifas, impresión, formato y facturación Shopify permanecen en Más acciones en todos los tamaños.
- Incidencias y Enviados: selección, Pedido, Cliente, Transportista, Seguimiento; las demás columnas continúan disponibles. El texto del transportista, último movimiento y días sin movimiento se muestran sin tooltip. Los terminales no acumulan un aviso de días sin movimiento.
- Acceso rápido a la web del transportista. Si falta URL registrada, el servicio existente la resuelve solo al pulsar; no hay consultas por fila durante el render. Se valida la URL con la política existente, se elimina `opener` y no se ofrecen enlaces de registros purgados.
- Se conservan las nueve capturas aprobadas de Pendientes/Incidencias/Enviados como `approved-<pestaña>-<ancho>.png`; las nuevas `after-*` cubren 390/1280/1440. El harness exige cabecera en una fila y Seguimiento dentro del ancho visible a 1280/1440. Verifica inventario de columnas en las cinco listas y acciones originales.
- La configuración existente de producción es `DD/MM/YYYY`, `es`, `Europe/Madrid`; defaults equivalentes cuando faltan. La pantalla actual se inspecciona con sesión real y muestra `22/10/2026 13:40`. Se verificará de nuevo tras el despliegue.
- Prueba nueva reproducida en rojo antes del cambio de presentación y luego verde. Suite completa final: 98 archivos, 525 pruebas; Node: 1.280, cero fallos. Prueba adicional de columnas/enlace a demanda y compilación de producción correctas (bundle index-C-75ylnX.js). 21 capturas after, nueve interacciones, tres comparaciones de inventario y cuatro comprobaciones de seguimiento sin scroll, todas correctas.

## Preflight de base de datos — 12:43 UTC

Lectura previa: 1.022 pedidos (instantánea; puede variar por operación normal), proyección `read_enabled=true`, `maintenance_enabled=true`. Todos los anclajes requeridos de la migración están presentes. La RPC nueva aún no existe.

| Objeto existente | MD5 de definición |
|---|---|
| public.orders_dashboard_pickup_v1 | 4a5d7ee5c3d93eb71e22f4b51f7a2e63 |
| private.mfa_impl_orders_dashboard_pickup_v1 | d4bd810879d920b7f9761633fdc9bbc8 |
| private.pickup_report_owner | 0611e2d475ee2de26baa021db3ee4b11 |

Manifest MFA: 41 entradas; fingerprint ordenado `4c662081cd1fa31fcb4f8e6dee746ed9`. La migración agrega el wrapper protegido de la nueva API al manifiesto; no altera wrappers previos, piloto, autenticación ni configuración MFA. Comprobar fingerprint de las 41 entradas anteriores tras aplicarla.

## Orden de publicación y rollback preparado

1. CI verde del commit exacto y revisión visual terminada.
2. Aplicar únicamente `supabase/migrations/20261022114001_orders_workbench.sql` en `sjkxxbedkkmgmqnvaqjh`. Es aditiva: funciones nuevas y una entrada de manifiesto; sin DELETE/UPDATE de negocio/DROP, sin reprocesado ni reset de estadísticas.
3. Verificar hashes anteriores, permisos de la RPC nueva, aislamiento y resultados con la sesión real. Publicar frontend después de comprobar el backend.
4. Fusionar #284; Vercel publica main. Verificar SHA y alias de producción, seis pestañas, fechas, acciones y Resumen.
5. Si falla frontend: restaurar el despliegue anterior `dpl_usywB96ezEmZNWpSNGqPK7r1wFeG` (Vercel rollback a su URL). Alternativa: revertir el merge en Git y publicar. La RPC anterior permanece idéntica; dejar la nueva RPC sin uso. No borrar funciones, modificar datos de pedidos, tocar cron ni cambiar interruptores de proyección para revertir.

No se generan facturas, etiquetas, pedidos ni informes reales en esta revisión. No se modifican PayPal ni suscripciones.

## Consumo y continuidad

Programada comparación de consumo para el 23/10/2026 a las 11:20 Europe/Madrid. Conservar la ventana desde 22/10 a las 11:19 y no resetear pg_stat_statements. Comparar CPU/memoria/top normalizado y dimensionamiento hipotético para 10/50/200 clientes.

## Recibos

Pendientes de completar con resultados reales de CI, migración y despliegue.

### Revisión independiente

Revisor de solo lectura: 42 pruebas focalizadas correctas; detectó una P2 al mostrar movement_at inferido como movimiento real. Corregida: se conserva la distinción original Detectado / Último movimiento; prueba de regresión para respuesta sin fecha del transportista. Sin P1 ni fallos de alineación o propagación de acciones.

### CI y backend publicados — 14:57 Madrid

- Commit remoto revisado `ee61aacd79661202b231e7397ad7530836639767`; su árbol `35b2d329b4f006610db797bd9830aa4c022afed3` coincide exactamente con el árbol local verificado. Subido mediante conector de GitHub porque Git push no tenía credenciales.
- CI 6/6 success: Shared UI 39781574185; Build check 39781574172; Auth resilience 39781574192; Build 39781574254; MFA disposable 39781574183; visual 39781574233.
- Migración aplicada correctamente en Gestión: `orders_workbench`, versión remota `20261022125659` (contenido del archivo local `20261022114001_orders_workbench.sql`). Sin reprocesado, cambios de negocio ni reset de estadísticas.
- Hashes de la RPC anterior, implementación anterior y pickup_report_owner idénticos al preflight. Las 41 entradas anteriores conservan fingerprint `4c662081cd1fa31fcb4f8e6dee746ed9`; manifiesto total 42, todos los hashes válidos. Proyección read/maintenance siguen true.
- RPC pública nueva: anon EXECUTE=false; authenticated/service_role=true. Implementación privada: anon/authenticated/service_role=false. Wrapper protegido por pickup_report_owner, pruebas de MFA/permisos/tenant en CI.
- Advisor incorpora el aviso genérico `authenticated_security_definer_function_executable` para la nueva RPC, coherente con el wrapper expuesto intencionalmente: acceso denegado a anon, cuerpo con comprobación MFA/tenant/permiso y sin acceso directo a implementación. Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable . No se silencian ni cambian alertas históricas.
- PR #284 fusionada mediante expected-head en `0c84d23508b91f1c0fab339632ac3d84976b2a7d`. Pendiente comprobar el despliegue de Vercel y la sesión real.

### Verificación real y ajuste de cascada — 15:00 Madrid

Vercel publica `dpl_3wtaTuEXnEvcZjP2mWAFzdMPNk1G`, main `0c84d23`, árbol idéntico al verificado. Con sesión real del piloto:
- Los cinco KPI trasladados a Resumen y el desglose por transportista coinciden exactamente con la comprobación previa. Se omiten importes operativos reales del diario público.
- Pendientes conserva los mismos tres pedidos; fechas de producción DD/MM/YYYY HH:mm. Incidencias devuelve ocho registros con motivo y acceso MRW visibles.
- La prueba de geometría real a 1280 encuentra Seguimiento hasta x=1387 frente al límite x=1227: motivo parcialmente fuera del área visible. No se considera terminada la publicación.
- Causa reproducida: la importación CSS del componente ocurre antes de main, mientras el harness la añadía al final; orders-products.css imponía 315 px a la cuarta columna y 340 px a la quinta. Con el orden de producción, la regresión falla también con fixtures sintéticos (x=1387 > x=1242).
- Corrección acotada: reglas semánticas de las colas con especificidad `.ordersWorkbench .ordersTrackingFirst`, independientes del orden heredado. Harness carga CSS de componentes antes del global, como el entrypoint real. Sin cambios de backend, datos, MFA ni integraciones.
- CI del primer despliegue confirma 98 archivos / 526 pruebas Vitest correctas; más 1.280 Node.
- No se suben capturas con clientes reales a este repositorio público. La evidencia versionada usa fixtures sintéticos; la geometría y cifras anteriores se registran sin identificadores de clientes.

La migración se renombra en el repositorio a `20261022125659_orders_workbench.sql` para coincidir con la versión remota registrada por apply_migration. Su contenido no cambia y no se ejecuta de nuevo. Tests y referencias operativas apuntan al nombre canónico; se conserva arriba el nombre original revisado como trazabilidad.

### Validación del ajuste de cascada

- Regresión reproducida primero en rojo con el orden CSS real; corregida en verde. Con fixtures y cascada real Seguimiento termina en x=1043,16 dentro de x=1242 a 1280, y dentro de x=1402 a 1440; Enviados e Incidencias correctos.
- Rehechas las 42 capturas antes/después con el orden corregido, nueve interacciones y tres comparaciones de inventario: sin fallos.
- Revisión independiente de CSS/harness sin P1/P2.
- Primer test completo en el checkout nuevo: workbench-tabs falló por resolver @zenvia/ui desde las dependencias prestadas del checkout antiguo. Se aisló el enlace al paquete de este checkout; no se cambia código de UI por ese fallo de entorno. Se repite la suite completa antes de subir.
- Rollback del ajuste: frontend `dpl_3wtaTuEXnEvcZjP2mWAFzdMPNk1G` conserva la nueva bandeja (con el recorte conocido); rollback completo a `dpl_usywB96ezEmZNWpSNGqPK7r1wFeG` conserva la pantalla anterior y RPC previa. No hay que revertir base de datos.

Resultado local final del ajuste: 98 archivos / 526 pruebas Vitest correctas; 1.280 pruebas Node correctas; cuatro casos SQL de workbench con nombre canónico correctos; compilación de producción y verificación de icono correctas. Único aviso de build: tamaño de bundle Vite ya existente. Ningún documento real generado.

### CI y publicación del ajuste de cascada

Commit remoto final `a9e71140d29daba8787126d36e6aa709d26c0cdb`. CI 6/6 success: Shared UI 39785025637; Build check 39785025600; MFA disposable 39785025619; Auth resilience 39785025663; Build 39785026103; visual 39785025639. PR #285 fusionada, main `c570c47dd688ece8d00e2c83c03653f45e00d9e4`. No se vuelve a ejecutar la migración ni se cambian funciones.

### Cierre verificado en producción

- Vercel READY: `dpl_7vBQnPC6hWVntVa7B8aNfh4AVHhc`, alias `gestion.zenviacommerce.com`, commit `c570c47dd688ece8d00e2c83c03653f45e00d9e4`. Árbol `8042fe6d9d763717d2e5dea351b1ef1fe6b7130e`, idéntico al árbol validado localmente y en la PR.
- Sesión real del piloto: acceso correcto tras recargar; Incidencias mantiene Pedido/Cliente/Transportista/Seguimiento. A 1280 Seguimiento termina en x=1031 dentro de x=1227; a 1440 x=1031 dentro de x=1387. Cabecera en una fila en los tres anchos; sin desbordamiento horizontal del documento. A 390 la tarjeta muestra motivo, fecha, antigüedad y acceso externo completos.
- Enviados: 158 resultados para el trimestre, misma cifra previa; a 1440 Seguimiento termina en x=1056,28 dentro de x=1387. Pendientes y Cancelados conservan sus cifras del mismo alcance; Informes muestra el historial guardado, sin crear ni reimprimir documentos reales. Las cifras de pestañas sin periodo son de todo el historial y vuelven al periodo al entrar en Enviados/Cancelados.
- Fechas observadas en pantalla y seguimiento: DD/MM/YYYY y hora de Madrid. Se conserva la distinción Detectado / Último movimiento.
- Comprobación final DB: fingerprint de los 41 wrappers anteriores idéntico; manifiesto válido; una sola migración orders_workbench; proyección read/maintenance true. Sin reset de estadísticas ni reprocesados.
- El historial de consola contenía mensajes de canal de extensión anteriores al despliegue (12:41 UTC); no se usan como defectos del nuevo bundle. No se observan errores nuevos en los flujos revisados.
- Viewport temporal restaurado y navegador dejado en Incidencias para comprobación del propietario. Capturas versionadas solo sintéticas. Próxima actuación: comparación de consumo programada 23/10 a las 11:20 Europe/Madrid; después backlog aprobado en su orden.
