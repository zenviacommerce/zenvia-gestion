# Cuentas bancarias: publicación bloqueada por el conector — 2026-10-21

## Estado verificable
- Publicación autorizada por el propietario tras el retoque de PR274.
- Head preparado: 851aa30c27f727cbbfb3037eacbd3ce78a0c9974; árbol d07aaebde3f37c39a25ababe211acec88c487588.
- Selector dentro de Fechas y cobro y visible sólo con transferencia en factura, recibo y Shopify. 33 PNG antes/después a390/1280/1440; README y manifests en la misma carpeta.
- Verificación local:316/316 Vitest,1244/1244 Node/SQL, build correcto; revisión independiente17/17. CI remota6/6 del head anterior en verde.
- SQL mostrado antes de intentar la aplicación:26 facturas legacy_current_render,2 legacy_missing,8 recibos legacy_missing;1 cuenta a importar. Sin DELETE. Snapshot privado previsto antes de los UPDATE.
- SQL SHA256:93914b600f3e1a7c5aa29f434c0c63119c9497382b70ee5c9bf3a2898373574f.

## Bloqueo y comprobación posterior
apply_migration devolvió MCP -32602 INVALID_ARGUMENT, reason invalid_request_state: «Invalid or expired requestState». También ocurrió al solicitar una nueva llamada tras una comprobación de lectura correcta. No es un error SQL ni una denegación de seguridad identificada.
La lectura execute_sql funciona y confirmó después del último intento:
accounts_table_exists=false; release_snapshot_exists=false.
Por tanto, no hay confirmación de migración ni snapshot aplicados. No se fusionó PR274 ni se publicó el frontend bancario. No se sustituyó apply_migration por SQL DDL en execute_sql ni se alteraron permisos del plugin. El plugin figura instalado y habilitado, sin mecanismo de renovación de sesión expuesto en las herramientas disponibles.

## Rollback preparado
Producción previa: main2f8cc07d7bf46a0063b505106f962fc350e6f1ec, deployment dpl_pftFospm77ikRDdhBXUQKRVJGk2v. Mantener esquema/snapshots aditivos; restaurar frontend previo sólo antes de documentos nuevos con snapshot bancario. Después, conservar lector/guardas de snapshot y corregir hacia delante. Sin DROP ni DELETE.

## Reanudación
Restablecer la sesión del conector Supabase; comprobar primero estado e historial por lectura; aplicar exactamente el SQL ya mostrado si sigue ausente; verificar snapshot, invariantes, ACL y hash MFA; alinear nombre de migración con versión registrada y esperar CI; publicar PR274 y verificar deployment/alias y lecturas sin emitir documentos reales. El propietario revisará su cuenta en General.
Después empezar lote C (Resumen, Planes, Facturación, Usuarios, Auditoría y formularios) con estimación4–7h, capturas y parada antes de publicar. No se ha adelantado su implementación. Se conservan el MFA y los datos de negocio.
