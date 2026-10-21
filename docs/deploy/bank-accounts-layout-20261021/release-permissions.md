# Verificación adicional de permisos — 2026-10-21

Comprobada por consultas de catálogo tras aplicar20261021200504:
- Tabla business_bank_accounts: políticas permisivas SELECT/INSERT/UPDATE para authenticated con propietario/admin; cuatro gates MFA RESTRICTIVE. No permiso SELECT anon.
- save_business_bank_account, set_default_business_bank_account y archive_business_bank_account: SECURITY INVOKER, anon EXECUTE=false, authenticated EXECUTE=true.
- Los cuatro snapshots privados bank_release_20261021_*: anon SELECT=false y authenticated SELECT=false. Copia de función Shopify:1definición.
- Advisors de seguridad ejecutados: ningún hallazgo menciona business_bank_accounts ni bank_release_20261021. No se corrigen avisos previos ajenos a este despliegue.
- Hash funciones MFA idéntico al preflight8b9511326b3cbcd562c48524050850c5.

Prueba exclusivamente de lectura; no emisión/envío ni cambios de usuarios.
