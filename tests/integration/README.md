# Prueba de integración de importación de facturas

`schema.sql` es el esquema real de producción (tablas, restricciones, tipos y triggers de facturas,
líneas, productos, proveedores, historial de precios, documentos y Gmail) exportado el 19/10/2026.
Las políticas RLS y las funciones de autorización (`private.app_*`, `private.mfa_allowed`) son stubs:
esta prueba valida el flujo de datos, no los permisos (cubiertos por `tests/mfa-sql.test.ts`).

Local:
```
psql -f roles.sql && createdb zvit && psql -d zvit -f schema.sql -f grants.sql
postgrest pgrst.conf   # db-uri=postgres://authenticator:authpw@127.0.0.1/zvit, jwt-secret=$ZG_IT_JWT_SECRET
ZG_IT_PGRST=http://127.0.0.1:3000 ZG_IT_JWT_SECRET=... ZG_IT_PSQL="psql -d zvit" npx vitest run tests/invoice-import.integration.test.ts
```
