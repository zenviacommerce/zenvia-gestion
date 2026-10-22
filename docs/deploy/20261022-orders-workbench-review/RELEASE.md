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
