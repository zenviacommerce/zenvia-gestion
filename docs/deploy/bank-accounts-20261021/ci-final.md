# Cuentas bancarias — CI final y punto de parada

2026-10-21. PR #274 lista para revisión, SIN merge y SIN publicación/migración bancaria.

Head revisado: d5e47b2b204aa9f242231d764fe0e13239de2e5b; árbol 0fe35b2198f80c6b63a11e8a9fdb11ca2dcb8ac6, cotejado con git write-tree del checkout local. Base main2f8cc07d (Productos publicado).

CI GitHub6/6 GREEN: Build2324/39637052159, Buildcheck633/39637052205, Auth302/39637052165, paquete7/39637052209, MFA desechable341/39637052240, visual156/39637052298. Status Vercel success (preview). La integración MFA es desechable; no se modificó el piloto de producción.

Verificación local final:310/310 Vitest(62archivos,2workers),1244/1244Node/SQL,buildTS/Vite/icono,diff-check. Revisión independiente sin bloqueantes;33regresiones focales repetidas.81PNG390/1280/1440 más2PDFficticios renderizados; hashes/fuentes/capturas en la rama de la PR. PDF/email prueban la cuenta congelada, nunca settings.iban vivo. No envíos ni emisiones reales.

Consulta sólo lectura de producción antes de detenerse: bank_table_exists=false; bank_migration_applied=false. La aplicación activa continúa en2f8cc07d, deploymentdpl_pftFospm77ikRDdhBXUQKRVJGk2v. PlatformB también permanece publicado y verificado, cobertura2/2.

SQL exacto, conteos de1cuenta/26facturaslegacy_current_render/2facturaslegacy_missing/8reciboslegacy_missing, efecto updated_at y rollback están en la entrega de revisión de la PR: https://github.com/zenviacommerce/zenvia-gestion/blob/feat/multiple-bank-accounts-20261021/docs/deploy/bank-accounts-20261021/review.md

Comparación visual: https://github.com/zenviacommerce/zenvia-gestion/blob/feat/multiple-bank-accounts-20261021/docs/deploy/bank-accounts-20261021/READMEvisual.md

SQL SHA256838539dd7e13540d566fe788be36adbec6c0d73f8c8328f8aa4506857912d7ba. Nombre local provisional porCLIausente; al aplicar se alineará versión de migración preservando SQL revisado. No DROP de datos durante rollback; tras nuevos documentos debe conservarse lector de snapshots.

DETENIDO por instrucción expresa del propietario antes de fusionar/aplicar/publicar bancos. Próximo orden: revisión/publicación bancaria autorizada → loteCPlatform → pendientesGestión(seguimiento primero) → MFA/Amazon. Sin nuevos trabajos del backlog en este paso.
