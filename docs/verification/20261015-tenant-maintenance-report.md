# Mantenimiento multi-tenant: cambios, evidencia, desviaciones y rollback

## Cambios aplicados

Producción sjkxxbedkkmgmqnvaqjh: migración `20261015220754_tenant_maintenance_owner_write_guards`.

- configuration_merge_supplier: usuario autenticado, workspace válido y administrador activo; UPDATE de invoice_lines acotado explícitamente por owner_id. Se bloquean los padres afectados y se rechazan referencias cruzadas antes de borrar/reasignar, incluidas las rutas de FK y triggers (supplier_products, invoices, products y product_price_history).
- configuration_rebuild_price_history_links: mismos requisitos de identidad/admin; rechazo explícito de un histórico de otro owner que ocupe invoice_line_id; el ON CONFLICT incluye además WHERE product_price_history.owner_id=excluded.owner_id como protección ante carreras.
- No se cambian los triggers, FKs, RLS, firma, propietario, search_path ni ACL de las funciones. Una referencia corrupta provoca 42501 y revierte toda la operación; el uso legítimo conserva su comportamiento.

La versión legible de las dos definiciones nuevas está en 20261015-tenant-maintenance-readable.sql. La migración reproduce el SQL compacto exacto registrado en Supabase.

## Evidencia

Prueba reproducible: `supabase/tests/20261015_tenant_maintenance_isolation.sql`. Ejecutar TODO el archivo con psql -v ON_ERROR_STOP=1 o execute_sql. Crea usuarios/tenants sintéticos, conserva los triggers/FKs reales y ejecuta las funciones como rol authenticated con JWT del tenant A; comprueba auth.uid y workspace resuelto antes de invocar. B se compara como snapshot JSON completo de suppliers, products, supplier_products, invoices, invoice_lines, product_price_history y audit_logs. Cada caso y la transacción completa se revierten.

| Caso | Antes | Temporal corregida + ROLLBACK | Producción corregida + ROLLBACK |
|---|---|---|---|
| Fusión legítima A; B intacto | Pasa | Pasa | Pasa |
| Destino de otro tenant | Pasa | Pasa | Pasa |
| B referencia supplier_product de A: UPDATE/FK | FALLA: B cambia | Pasa, 42501 | Pasa, 42501 |
| B referencia supplier de A: cascada | FALLA: B cambia | Pasa, 42501 | Pasa, 42501 |
| Histórico B referencia factura A: trigger | FALLA: B cambia | Pasa, 42501 | Pasa, 42501 |
| Crear y actualizar histórico legítimo A | Pasa | Pasa | Pasa |
| Histórico B ocupa invoice_line_id de A | FALLA: B cambia | Pasa, 42501 | Pasa, 42501 |

La prueba anterior falla realmente con TENANT_REGRESSION_FAILED y enumera las cuatro escrituras cruzadas. Después pasa 7/7 contra las definiciones definitivas. Las referencias mal formadas se construyen como administrador de fixtures, sin desactivar constraints/triggers; esto comprueba que los procedimientos no amplían una corrupción existente, sin afirmar que se haya demostrado su creación mediante la API pública.

Archivos: 20261015-tenant-red.json, 20261015-tenant-green.json, 20261015-tenant-functions-before.json y 20261015-tenant-post-verification.json.

Comprobación final: 0 workspaces de prueba y 0 usuarios auth de prueba persistidos. Ambas funciones siguen propiedad de postgres, SECURITY DEFINER, search_path vacío y ACL `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. No se han modificado filas comerciales reales.

## Desviaciones

pgTAP no está instalado; se usaron transacciones con ROLLBACK y aserciones SQL. La corrección se amplió respecto al simple predicado owner_id porque los tests demostraron otras dos rutas por cascada y trigger. No se alteraron los triggers de forma general.

El conector devolvió Invalid or expired requestState al enviar el bloque grande multilínea. Se verificó ausencia de cambios confirmados y se ejecutó SQL equivalente compacto. La corrección se probó de forma transitoria, se revirtió, se guardó el rollback en GitHub y solo después se aplicó la migración autorizada.

El advisor de seguridad conserva 4 avisos preexistentes; no se han corregido asuntos ajenos a estas funciones ni se afirma una auditoría global limpia.

## Rollback

`supabase/rollback/20261015_tenant_maintenance_original.sql` contiene pg_get_functiondef exacto de ambas versiones previas y transacción BEGIN/COMMIT. Fue capturado y publicado antes del cambio definitivo. Restaura únicamente los dos cuerpos, preservando las ACL y configuración preexistentes. Reintroduciría las vulnerabilidades, por lo que solo se usaría por una regresión operativa y tras evaluar el incidente.

Si se revierte una migración ya registrada, crear una nueva migración compensatoria con esas definiciones, en vez de borrar la entrada del historial remoto. Repetir el uso legítimo y comprobar privilegios; los cuatro tests de aislamiento deben volver a fallar con esas versiones antiguas, tal como documenta la evidencia roja.

Avisos existentes del advisor (sin nuevos tipos tras el cambio): [RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [extensión en public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [SECURITY DEFINER ejecutable por usuarios](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) y [protección de contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
