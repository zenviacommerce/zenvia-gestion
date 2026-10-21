# Prueba DEMO del índice central — 21 octubre 2026

## Alcance autorizado y estado
Prueba SQL sobre ticket real de DEMO (no ticket de ZENVIA), con outbox y receptor/reconciliador desplegados. No se usó el navegador para crear el ticket ni se afirma validación visual. Workspace DEMO 835a7f45-7edf-4af2-b455-a8ec9c9f07e0; ticket 4dceec2b-f8b2-4bb1-b8fd-5be567ee9011, número ZG-2026-000007, asunto y descripción marcados PRUEBA SOMBRA. Creación mediante trigger normal y claims del usuario DEMO. Sin cambios Auth/MFA, frontend, Edge ni flag de lecturas.

## Resultados medidos
Todas las horas UTC del 21 octubre 2026. Cota vigente 900 s.

| Paso | Escritura fuente | Recepción central | Segundos | Resultado |
|---|---|---|---:|---|
| Creación open / normal / sin asignado | 10:08:29.396712 | 10:09:02.664679 | 33,267967 | Correcto |
| Estado in_progress | 10:09:21.497808 | 10:10:03.048482 | 41,550674 | Correcto |
| Prioridad high | 10:10:14.491590 | 10:10:39.551087 | 25,059497 | Correcto |
| Asignado al usuario DEMO | 10:11:06.732315 | 10:11:42.621627 | 35,889312 | Correcto |
| Evento perdido, prioridad urgent | 10:23:18.548890 | 10:24:01.782852 | 43,233962 | Recuperado por reconciliación programada |
| Cierre closed | 10:24:21.292499 | 10:25:03.221794 | 41,929295 | Correcto |
| Eliminación y tombstone | No aplicada | No comprobado | — | Bloqueado |

La simulación de evento perdido no desactivó receptor, triggers ni fuentes de negocio. En una sola transacción se cambió únicamente el ticket DEMO a urgent y se marcó su evento recién generado como entregado con DEMO_TEST_SIMULATED_LOST, conservando el evento como evidencia. Event id f88dbdb2-f47a-4cc3-a24c-35977ac2fd9e; payload NULL acredita que no fue reclamado/enviado. La siguiente reconciliación natural recuperó la revisión. No se forzó manualmente un bootstrap o reconcile para conseguir ese resultado.

Comprobación central de 10 recibos del ticket: 0 apariciones de PRUEBA SOMBRA y 0 claves subject/body/description/created_by_email/created_by_name/raw_payload. subject NULL en el índice durante todas las lecturas. Metadatos de estado, prioridad y asignación coinciden. El usuario asignado es el de DEMO, no un usuario de ZENVIA.

## Bloqueos y limpieza pendiente
El intento de retirar el evento por DELETE caducó y no se aplicó (se verificó fuente sin cambios). Se sustituyó por la simulación conservadora descrita arriba. El posterior DELETE del ticket, acotado por UUID + workspace + asunto exacto, devolvió también McpServerError: Invalid or expired requestState. No se ha eludido esa confirmación mediante otra ruta.

La última lectura confirma ticket **closed**, índice **deleted=false**, revisión 6. La limpieza NO está completa y el tombstone NO está validado. Para continuar: ejecutar el borrado autorizado exclusivamente del ticket de prueba, verificar tombstone y ausencia del ticket fuente, y conservar únicamente evidencias sanitizadas/retención normal. No borrar auditoría de negocio para ocultar la prueba. No hay adjuntos ni mensajes creados por esta prueba.

El control del navegador enumera pestañas pero al navegar devuelve Chat API request failed (HTTP 401); no es evidencia de fallo HTTP de Platform. No se obtuvieron capturas antes/después. No se extrajeron credenciales ni se fabricó una sesión.

## Estado seguro de parada
Lectura directa a las 10:27:44 UTC: outbox pendiente 0, failed 0 y fallos de captura 0. Cobertura 2/2 fresca en la observación anterior, sin alertas. Una lectura central de outbox con antigüedad mostraba 1 pendiente; lectura directa posterior confirma drenado. enabled=true, dedicated_enabled=false, **read_model_enabled=false**. No se publican cambios ni se fusiona main.

La autorización de cambiar lecturas depende de completar todos los pasos: aún faltan borrado/tombstone/limpieza y capturas. No se afirma que toda la prueba haya pasado. Rollback de sombra ya documentado en rollback-source.sql y rollback-central.sql; no ejecutado. El backlog de envíos se registra en Gestión docs/deploy/20261021-shipping-backlog.md sin implementarlo, manteniendo Platform → MFA → Amazon.
