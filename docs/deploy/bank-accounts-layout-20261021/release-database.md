# Migración bancaria aplicada — 2026-10-21
Supabase Gestión sjkxxbedkkmgmqnvaqjh. Reconexión confirmada por propietario; apply_migration devuelve success:true.
SQL revisado 20261021190521_multiple_business_bank_accounts registrado por MCP como **20261021200504_multiple_business_bank_accounts**; bytes conservados SHA25693914b600f3e1a7c5aa29f434c0c63119c9497382b70ee5c9bf3a2898373574f. El cambio de nombre sólo alinea el historial.
Snapshot privado:2 business_settings,28 facturas cerradas/reabiertas,8 recibos y definición original Shopify.
Verificación de producción por lectura:
-1 cuenta importada,1 predeterminada,1 válida; IBAN coincide con normalización del legado.
-26 facturas legacy_current_render conservan IBAN exacto mostrado antes;2 legacy_missing;8 recibos legacy_missing.
-Comparación completa JSON de28facturas/8recibos contra snapshot: sin cambios fuera de nuevas columnas bancarias/updated_at. Configuración completa idéntica.
-Tabla bancaria con RLS; anon sin SELECT; snapshots sin SELECT authenticated.
-Hash funciones MFA 8b9511326b3cbcd562c48524050850c5 idéntico al previo.
No se emitió/envió ningún documento real ni se modificó el piloto MFA.
Rollback frontend preparado dpl_pftFospm77ikRDdhBXUQKRVJGk2v / main2f8cc07d7bf46a0063b505106f962fc350e6f1ec; conservar SQL/snapshots aditivos. Tras documentos nuevos con snapshot, preservar lector/guardas y corregir hacia delante.
Frontend aún pendiente de CI y publicación al generar este recibo; la autorización sigue vigente.
