# Lecturas centrales de Platform activadas — 21 octubre 2026

## Resultado
Activado read_model_enabled=true a las **11:05:43.117355 UTC / 13:05:43 Madrid**. dedicated_enabled=false. Replicación compartida, outbox y reconciliación continúan activos. El propietario validó las capturas después; véase cierre al final. No se atribuye al asistente esa validación visual.

Platform producción: commit **7b461c2fde2598794777c28ff86f6761f0186656**, deployment **dpl_F8yrj4b1P6zCdqbyDEzsbK8xMUU9**, READY, dominio admin.zenviacommerce.com. HTML público verificado: **index-44hb7cxm.js**. Edge platform-admin **v38**, JWT verificado activo; código descargado tras desplegar coincide con lo preparado y dependencias idénticas a v37. Gestión #269 fusionada en **3decf71a4ce436fe4762b9d5cd0aad9800d285b2**, despliegue READY sin cambios de interfaz de Gestión.

## Comparación
Datos del antes aportados por el propietario. Después comprobado por SQL a las11:06:29 UTC, no por navegador.

| Dato | Antes propietario | Lectura central activa | Diferencia |
|---|---:|---:|---:|
| Clientes | 2 | 2 | 0 |
| Suscripciones activas | 2 | 2 | 0 |
| Tickets pendientes | 0 | 0 | 0 |
| Por responder | 0 | 0 | 0 |
| Planes activos | 4 | 4 | 0 |
| Tickets de prueba operativos | 1 (ZG-2026-000007 cerrado) | 0 | Limpieza autorizada |

Cobertura fresca2/2, contadores sobre índice completo, no sobre la página. La bandeja está vacía porque ambos tickets de prueba fueron borrados; no se perdió un ticket real. Se conservan tombstones/auditoría y recibos bajo retención normal como evidencia.

## Asunto autorizado y E2E
Decisión explícita del propietario: replicar asunto de soporte, máximo200caracteres, porque Platform ya lo trata como encargado del servicio. Lista blanca explícita; left(subject,200) en fuente, rechazo de longitud/tipo inválidos en receptor. Nunca cuerpo, descripción, mensajes, adjuntos, email/nombre del autor ni datos de compradores. El detalle sigue en la instancia, con rutas y permisos originales.

- ZG-2026-000007 (DEMO) borrado **10:31:20.372111 UTC**, tombstone10:32:02.145256: **41,773145s**.
- Segundo ticket temporal DEMO ZG-2026-000008: creado10:51:22.746403, asunto recibido10:52:01.479485: **38,733082s**.
- Asunto actualizado y estado cerrado/prioridad urgente/asignado DEMO a10:53:04.674705, recibido10:54:01.632401: **56,957696s**, coherente con despertar cron por minuto.
- Búsqueda por asunto actualizado devuelve1; filtros combinados cliente/estado/tipo/turno/prioridad/asignado devuelven1; estado abierto y workspace ZENVIA devuelven0. Probado lector real mediante SQL transaccional con flag temporal y ROLLBACK antes de activación global.
- Segundo ticket borrado11:03:45.966423, tombstone11:04:01.943402: **15,976979s**.
-10recibos del segundo ticket: **0fugas del marcador de cuerpo y 0claves prohibidas**. Asuntos presentes mientras ticket activo; tombstone limpia subject aNULL.
- Lectura fuente11:06:59: **0tickets de prueba restantes**.
- Prueba de evento perdido anterior sigue acreditada en demo-e2e.md: recuperado por reconciliación natural en43,23s, sin forzar bootstrap.

El permiso anterior caducado era un problema de aprobación, no de PostgreSQL. El primer intento de borrar el segundo ticket también caducó; se reemitió un permiso específico y se ejecutó al aprobarlo. Ninguno de los intentos caducados se aplicó.

## Paridad de bandeja y límites
Conserva Ticket/Cliente, ASUNTO, Prioridad, Estado, Actividad, tipo/icono, turno y asignado. Búsqueda por número, asunto y cliente; no se anuncia búsqueda por email, que no se replica. La línea con nombre/email del autor tampoco se centraliza; información completa bajo demanda en detalle. Este límite es deliberado y explícito, no una afirmación de búsqueda global por email.

Página25 con cursor de orden/workspace/id, búsqueda/filtros/orden en servidor y totales sobre todo el filtro. Se conservan acciones, edición, borrado y detalle autorizados por instancia. Refresco visible25s, sin vaciar lista ni filtros. Botones de paginación se bloquean mientras navega y transiciones no saltan cursor al pulsar dos veces.

Cobertura se asocia a generación actual y salud de captura: generación nueva o fallo conocido sin reparar no puede convertirse en total exacto0. Dedicadas desactivadas se consideran sin cobertura si aparecen; no se excluyen silenciosamente del esperado. Totales incompletos sonNULL y se muestran Sin datos/conocidos y cobertura.

## Evidencia técnica y CI
Gestión: **1237tests Node +257 Auth/Vitest**, CI completa del head **1a01931111cfe8aa7160cceb6a3c24b2012c83f2** verde (Auth/Vault real, capturas, builds, Auth). Platform: **271tests +build**, CI completa del head **b31676d11e8a8fe2f183bd7bc6043a0e08d17224** verde. Árboles de commits probados y squash de producción idénticos en ambos repositorios. Deno2.5.6 check platform-admin correcto.

Revisión independiente identificó generación, captura sin reparar, dedicadas, doble navegación y orden numérico; se corrigieron con pruebas de regresión. Orden natural preserva2antesde10 y normalización española. RPC solo service_role; anon/authenticated sinEXECUTE, comprobado en producción. Hashes de todas las funciones MFA iguales al snapshot en ambos proyectos. No cambios Auth/cohort/piloto.

Ensayo aislado lector con502workspaces/5032tickets: página25,12.334bytes, p50=31ms/p95=34ms (10lecturas PGlite; no equivale a red/API). EXPLAIN ANALYZE de RPC real con índice actual vacío: ejecución7,665ms,0lecturas de disco; plan exterior de función, no se afirma inspección de cada plan anidado. La medida previa del trigger de pedidos +0,113ms sigue documentada; este cambio solo añade campo de soporte.

## Migraciones y observabilidad
Aplicadas y nombres del repo alineados:
- Platform20261021104838_platform_shadow_ticket_subject.sql
- Platform20261021104850_platform_shadow_read_model.sql
- Gestión20261021105109_platform_shadow_ticket_subject.sql

Snapshots previos en subject-before-source.json /subject-before-central.json y diarios previos; funciones/captura fail-open conservadas. Migración central inicialmente deja generación de coberturaNULL; siguiente ciclo completo la establece. No relleno optimista. Más de2ciclos naturales entre aplicación y activación; observados10:50:04,11:04:01 y11:06:01 sin error.

A11:06:59UTC, fuente directa: **0pendientes,0failed,0fallos de captura**. Central cobertura2/2 fresca, alerta inactiva, último errorNULL. La observación central11:06:30 conservaba snapshot de1pendiente tomado justo antes del drenaje; no confundirlo con fallo o cola bloqueada. Presupuesto900s. Advisor sin advertencias nuevas en objetos de sombra; avisos previos ajenos se mantienen.

## Rollback
**Inmediato, sin desplegar:** en Platform ejecutar rollback-read.sql: UPDATE private.platform_shadow_config SET read_model_enabled=false WHERE singleton; comprobar respuesta enabled=false. Mantiene replicación/reconciliación, no borra datos y el frontend conserva la ruta anterior. No ejecutado tras activación.

Si fuera necesario: restaurar platform-admin v37 desde maincbee862fb15424945c72c6edb0933a61c81b114f; la comparación previa del handler quitando únicamente las ramas nuevas era exacta, dependencias diferían solo en salto final. Rollback Vercel al deployment **dpl_7stTb8dioa6tSBnRwKpa8V7gbv1W**. Sin volver a capturas inseguras ni borrar tablas/colas. Aprobación de publicación proviene del propietario; capturas después validadas por el propietario; cierre al final.

Backlog de envíos registrado sin implementar en Gestión docs/deploy/20261021-shipping-backlog.md. Se mantiene el orden Platform → MFA → Amazon. No se amplía ni se cierra el piloto MFA por este trabajo.


## Cierre validado por el propietario
El propietario confirmó en su navegador con read_model_enabled=true: Resumen2/2/0/0/4 idéntico al antes, indicador «Cobertura2/2 · Última conciliación21/10/26,13:06»; Tickets conserva Ticket/Cliente, ASUNTO, Prioridad, Estado y Actividad, filtros y buscador, muestra0tickets tras limpieza y cobertura2/2. **Lote A CERRADO**. Validación visual aportada por el propietario, no automatizada por el asistente. Rollback permanece preparado en rollback-read.sql. Siguientes pasos autorizados: extracción @zenvia/ui sin diferencias visuales (detener antes de publicar) y luego loteB de Clientes/Workspaces/Tickets con revisión previa.
