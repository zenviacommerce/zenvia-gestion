# Bridge: lectura exacta de uso de un workspace

21-10-2026. Dependencia de la PR separada de datos de Platform. Se añade workspace_usage después de la validación de token y assertBridgeMfaAllowed existentes; no se cambia ninguna regla de Auth/MFA ni frontend.

COUNT HEAD exactos y acotados por workspace: usuarios activos, Amazon status <> disabled, pedidos operativos del mes UTC por order_created_at. Errores por métrica se devuelven como null. No descarga listas ni datos personales.

Comparación SQL previa: ZENVIA 5/1/164; DEMO 1/0/0. UI de Platform antigua muestra 0/0/0 en ambos. Tests: 1226 Node y 257 Vitest correctos; build correcto. La prueba nueva valida scope, activos, mes UTC y fallo parcial.

Rollback antes de publicación: bridge desplegado v31, verify_jwt=false, commit d688e654b742dbe86ad9463f8a8f8b90a49bce94 y copia completa recuperada mediante get_edge_function. Redeploy del bundle original y dependencias manteniendo autenticación propia y MFA. Acción aditiva, sin migraciones ni datos que revertir. Platform puede mostrar Sin datos si no dispone de esta acción. No activar consumidores hasta pasar CI.
