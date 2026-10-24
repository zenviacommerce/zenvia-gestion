# Seguimiento, PDF/XSD y pasarela de pruebas — plan

> Ejecución continua autorizada por el propietario. Implementación inline con pruebas RED→GREEN y revisión independiente final. No publicar cambios visibles ni aplicar SQL nuevo sin presentar paquete revisable. No tocar legado, emitir documentos reales, pedir certificados o crear recursos nube.

## Diseño y decisiones

Fase 1 aceptada visualmente en F202649: PDF/impresión/Gmail/Cobrada/Anular/Crear rectificativa presentes, Editar/Borrar/Reabrir ausentes. Conservar sin tocar legado, incluidas F202650/F202654.

1. Informe de integridad en Gestión: consulta bajo demanda desde Facturación (sin carga de fondo al abrir Pedidos), resúmenes diarios y problemas sanitizados. RPC de solo lectura con owner/permiso/MFA, sin copiar snapshots a UI ni escribir sobre las cadenas. Verifica canonical/hash/link/secuencia/cabeza y eventos. Alternativas: panel nuevo en Platform (amplía alcance/identidades), informe solo chat (no queda en app); se elige modal Gestión y automatizaciones de lectura diarias/horarias como cobertura inmediata. Fallo de monitor es estado desconocido, nunca verde.
2. PDF: preparar QR ISO18004 nivel M, 30–40mm, formato URL oficial. Interruptor cerrado por defecto para documentos reales; solo preview sintética marcada sin validez fiscal hasta aprobar conexión/semántica normativa. Nunca añadir VERI*FACTU a facturas solo sombra como si estuvieran remitidas. Altas/anulaciones XML desde snapshots inmutables, validación XSD offline con schemas oficiales fijados por SHA256. Sin inventar campos fiscales ausentes: error explícito y bloqueo de transporte.
3. Pasarela Go para Cloud Run: crypto.Signer KMS/HSM remoto, sin exportar claves; mTLS local con CA/certificados sintéticos efímeros; destino AEAT PRUEBAS fijado, producción inhabilitada, límite/tamaño/timeout y redirecciones cerradas. No tráfico real AEAT autenticado sin certificado autorizado. Docker y guía de alta/WIF/IAM/Bélgica/25EUR preparados, sin despliegue ni recursos.

## Tareas

- [x] 1. Guardar aceptación fase1 y automatizaciones de lectura; baseline aislada limpia y pruebas iniciales.
- [x] 2. Tests de informe SQL: cadena correcta/vacía; digest/canonical/enlace/secuencia/cabeza/eventos alterados en fixture desechable; tenant/MFA/ACL; no mutación. Migración aditiva y rollback que solo retira nuevos RPC/manifiesto.
- [x] 3. UI informe con @zenvia/ui, estados loading/error/empty/incidencia; cero carga hasta abrir; inventario y capturas desktop/mobile light/dark.
- [x] 4. Revalidar fuentes QR/AEAT, test RED→GREEN builder URL/política PDF/XML alta-anulación y XSD oficial con casos negativos. Capturas antes/después y PDF sintético; interruptor cerrado en producto.
- [x] 5. Implementar/testear mTLS+KMS signer Go en local; rechazar destinos, algoritmos, certificados incorrectos, redirect, sobrepeso y tiempo; entorno AEAT pruebas documentado sin afirmar conexión no realizada.
- [ ] 6. Actualizar guía alta GCP con fuentes oficiales; CI, suite/build, revisión independiente; borrador PR con SQL/rollback/activación, evidencias y limitaciones. Detener antes de publicar cambios visibles.

## Foco de revisión

Una rotura no se oculta tras truncar incidencias; cadenas múltiples se verifican aisladas; errores XSD no se confunden con validación de negocio AEAT; ningún PDF legado cambia; modo sombra no presenta factura como remitida; clave mTLS nunca sale de HSM por comodidad; pruebas locales no se anuncian como homologación AEAT. Ninguna aprobación fiscal o de nube se infiere del desarrollo de código.

Estimaciones al inicio: seguimiento 1–2h; fase2 2–4h según adaptación al XSD; fase3 2–4h para código/probadores y guía, sin esperar certificado.
