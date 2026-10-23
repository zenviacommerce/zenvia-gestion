# Cancelar expediciones — revisión 2c

**No publicado.** Galería: [index.html](index.html). 102 capturas de datos sintéticos a 390/1280/1440, claro y oscuro. El harness carga el detalle y el modal reales, bloquea la red y sustituye únicamente los servicios externos.

Se muestran: antes y después de la expedición activa; modal y resultado de MRW, Sendcloud y Envia; estado incierto; detalle aún sin actualizar tras la confirmación (etiqueta inutilizable); cancelación confirmada con historial; nueva etiqueta con el historial anterior visible. El manifiesto recoge el inventario de acciones y el test exige conservarlas en la expedición activa.

Decisión explícita: Descargar e Imprimir permanecen, deshabilitados mientras una cancelación está pendiente/sin confirmar o no se puede cargar su estado. El bloqueo SQL ya existente impide generar etiquetas durante ese intervalo. Comprobar estado solo consulta; nunca vuelve a enviar la anulación. No hay Impresión directa ni cancelación de pedidos Amazon/Shopify en este flujo.

Los envíos registrados como externos se remiten a la agencia: su protección contra sobrescritura permanece. El transportista puede rechazar una cancelación; no se promete devolución del importe. Contratos probados con respuestas sintéticas oficiales; no se ha cancelado una expedición real.

## Rollback preparado para la eventual publicación

1. Volver al frontend estable con ambos hotfixes, Vercel `dpl_3doLvnXwT5fdfnxnyZsqcbGhMCDo`, commit `3dfd5f37433958bfe739c7232212dcbb38b6c179`.
2. Si se necesita restaurar SQL, primero pausar el endpoint con `supabase/rollbacks/order-cancellation-paused.ts`, conservando sus helpers vigentes de Auth/MFA, y drenar las peticiones anteriores durante el límite máximo de ejecución configurado de la función; no basta con ocultar el botón. Confirmar que ya no hay peticiones en vuelo. Después, si todavía no hay operaciones, ejecutar el rollback exacto `supabase/rollbacks/20261023070000_cancellation_identity.sql` (bloquea la tabla frente a inserciones y comprueba que no existe ninguna solicitud dentro de la misma transacción). Son CREATE OR REPLACE: conservan firmas y permisos; el helper privado puede quedar sin uso. No borrar tablas ni historial.
3. Si el guard rechaza el rollback, restaurar inmediatamente el handler nuevo de consulta y sus helpers Auth/MFA. Si hay operaciones pendientes/desconocidas, desactivar la entrada nueva del frontend y conservar el backend de consulta y sus protecciones hasta resolverlas. No restaurar el trigger antiguo sobre expediciones nuevas ni reenviar solicitudes.
4. El snapshot de `order-cancellation` v3 es evidencia del punto de partida, **no un bundle de rollback seguro**: contiene un helper antiguo sin la protección MFA vigente. Cualquier rollback de Edge debe conservar los helpers actuales de autenticación/MFA y retirar solo la capacidad nueva. No cambiar configuración ni cohorte MFA.
5. Antes de cualquier cambio de producción, volver a capturar versiones, hashes y recuentos y comprobar que la CI final está verde. Esta revisión no autoriza SQL ni despliegues.


Actualización tras los hotfixes #293/#294 publicados: integrado main3dfd5f37 y sus recibos, conservando cancelación2c sin publicar. Repetidos102escenarios/capturas (390/1280/1440,claro/oscuro), sin cambios de píxeles; el manifiesto cambia la base al código estable nuevo.740Vitest y1286Node verdes, build correcto; Deno correcto para handler de cancelación, pausa de rollback y MRW/Envia/Sendcloud. Solo conflicto documental, resuelto conservando ambas especificaciones. Sin nuevas llamadas reales a agencias, etiquetas, informes o correo. Requiere revisión del propietario antes de desplegar2c.
