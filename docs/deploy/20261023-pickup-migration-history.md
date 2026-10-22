# Alineación del historial de B

El gestor de Supabase asignó las versiones reales de aplicación. Se renombran exclusivamente los seis archivos SQL y sus referencias en tres pruebas para que futuros despliegues no intenten aplicar las mismas migraciones otra vez. El SQL, frontend, funciones y permisos permanecen idénticos. Mapa en20261023-pickup-migration-map.json.

Backend aplicado con6migraciones correctas; retención365,purga desactivada,0cron. Tres snapshots previos y guard MFA conservan exactamente sus hashes;0firmas y0correos de pruebas en producción. Frontend B publicado de forma independiente desde PR290, después de A289. El rollback operativo está en supabase/rollback/20261022_pickup_document_read_only.sql; no ejecutar DROP/DELETE para revertir evidencia firmada.
