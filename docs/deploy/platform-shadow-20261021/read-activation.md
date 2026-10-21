# Activación de lecturas centrales — 21 octubre 2026

## Autorización y contrato
El propietario autoriza incluir exclusivamente asunto de soporte <=200 caracteres. Platform ya accede al asunto como encargado del servicio de soporte. Se mantiene excluido cuerpo, descripción, mensajes, adjuntos, email/nombre del autor y datos de compradores. El asunto se trunca en fuente; central rechaza >200 y tipos anidados. Es un cambio explícito respecto al contrato anterior de solo metadatos.

## Prueba anterior completada
El DELETE de ZG-2026-000007 en DEMO se confirmó a las 10:31:20.372111 UTC. Índice deleted=true/revisión7 recibido 10:32:02.145256 UTC: 41,773145 s. Fuente remaining_ticket=0 y capture_failures=0 a las10:37:22 UTC. Se conserva tombstone y auditoría, sin ticket operativo.

## Capturas del propietario
El propietario aporta el antes: Resumen Clientes2 / Suscripciones activas2 / Tickets pendientes0 / Por responder0 / Planes activos4. Tickets mostraba 1 ticket cerrado ZG-2026-000007 DEMO PRUEBA SOMBRA Urgente. Tras el borrado autorizado, la comparación esperada de Tickets es0; la desaparición de esa fila es limpieza, no pérdida por migración. Las capturas después las hará el propietario; no se afirma comprobación visual automatizada.

## Implementación y comprobaciones
La bandeja conserva Ticket/Cliente, Asunto, Prioridad, Estado, Actividad, tipo/turno/asignado. Búsqueda central por número, asunto y cliente; no se anuncia búsqueda por email porque no se replica. Filtros/orden se ejecutan en servidor, 25 elementos por página con cursor de orden+workspace+id y conteos sobre todo el filtro. Búsqueda, filtro y detalle permanecen en React al refrescar; consulta visible cada25s. Detalle y mutaciones conservan la ruta autorizada a la instancia y sus permisos.

RPC solo service_role, llamada por platform-admin después de comprobar dashboard.view/tickets.view. No hay acceso del navegador a tablas privadas ni acceso directo a instancias para abrir Resumen/lista. Flagfalse conserva la ruta anterior.

Revisión independiente detectó y se corrigieron generación de cobertura, fallos de captura sin reparar, futuras dedicadas desactivadas que no deben omitirse como exactitud, doble navegación y ordenación numérica. Cobertura lleva generación y se marca al completar reconcile; no se rellena optimistamente. Totales incompletos son NULL y UI Sin datos/cobertura parcial. Tests RED→GREEN de cada riesgo de exactitud y orden numérico; prueba de paginación con controles bloqueados durante carga. Sourcefail-open y listas blancas continúan.

## Rollback preparado
Antes de modificar producción se capturan funciones SQL y hashes MFA en subject-before-source.json y subject-before-central.json. Reader flagfalse evita cambio de lectura durante aplicación. Emergency rollback: ejecutar rollback-read.sql y verificar enabled=false en la respuesta del lector; conserva outbox/reconciliación y el contrato seguro de asunto. Si falla Edge, restaurar platform-admin versión37 desde main cbee862fb15424945c72c6edb0933a61c81b114f; el handler coincide exactamente salvo las nuevas ramas de lectura, y sus dependencias difieren únicamente en salto de línea final. Vercel anterior: dpl_7stTb8dioa6tSBnRwKpa8V7gbv1W, commit cbee862fb15424945c72c6edb0933a61c81b114f.

## Pendiente de registrar al finalizar
CI remota de los nuevos heads, versiones aplicadas, verificación de asunto real DEMO, activación y comparación final. No interpretar esta entrada previa como prueba de despliegue completado.
