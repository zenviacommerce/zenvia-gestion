# Lote A en sombra — bloqueo de aplicación

21 octubre 2026, 09:59 Europe/Madrid.

CI verificada en verde antes de aplicar: Gestión #269, commit 03d7339c6b14cb16f5ff2864943017ea086b93ff (build, auth-tests, real-auth-vault y capturas); Platform #78, commit e5dddd13f5cdb486d47106809f1ad1bcce4099f7 (test-build).

Se guardó snapshot previo actualizado en pre-apply-source.json; rollback preparado en rollback-source.sql. La llamada apply_migration del núcleo devolvió literalmente `Migration was declined.` / status=declined para ambos proyectos. No se ha proporcionado una causa adicional. No es un fallo SQL ni de CI confirmado; no se ha intentado eludir el rechazo mediante execute_sql.

Verificación posterior a las 07:59:58Z: cero tablas private.platform_shadow_*, cero migraciones platform_projection_shadow_* y cero crons platform-shadow-* en ambos proyectos. No se desplegaron funciones nuevas ni se configuraron secretos ni se activó captura/reconciliación. Las lecturas UI continúan intactas. Rollback no ejecutado: no hubo objetos aplicados.

La comparación sombra/actual y los dos ciclos siguen pendientes porque no existe aún la proyección en producción. No se presentan valores ficticios ni se confunden los ensayos PGlite con ciclos de producción. Para continuar es necesario que el servicio acepte la aplicación de las migraciones ya autorizadas.
