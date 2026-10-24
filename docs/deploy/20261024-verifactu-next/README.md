# Seguimiento de sombra, fase 2 y preparación fase 3

**BORRADOR: sin SQL nuevo ni publicación en producción.** Fase 1 aceptada por el propietario en navegador real, F202649. [Aceptación](acceptance-phase1.md). La producción continúa en shadow desde 24/10/2026 21:22:05 UTC; al iniciar este trabajo tenía 0 RF y 1 evento.

## Seguimiento

Las tareas programadas están activas: informe diario desde 25/10/2026 por la mañana Europe/Madrid y alerta de integridad cada hora. Entregan el resultado aquí; la alerta permanece silenciosa cuando no hay problemas. Diferencian corrupción confirmada y fallo de verificación. No cambian datos, modo, MFA ni facturas.

El modal nuevo **Integridad sombra** de Gestión se entrega en esta rama, todavía sin publicar. Consulta solo al abrirlo: ninguna RPC adicional al entrar en Pedidos/Facturación. Muestra totales, últimos 31 días con actividad, últimos 25 RF sin datos del cliente, incidencias y hora de verificación. Cero RF es un estado vacío honesto, nunca una prueba de primeras facturas reales. Un error se muestra como estado desconocido, no como cero/verde. [Capturas](gallery.md).

Comprueba SHA-256, reconstrucción canónica, enlace y secuencia por emisor/instalación, cabeza almacenada, referencia alta/anulación y contenido/enlace/huella de los eventos. Todas las comprobaciones usan el mismo snapshot de lectura. Una edición maliciosa privilegiada que reescribiera coherentemente toda la historia requiere un anclaje externo para ser detectada; este verificador no equivale a una custodia externa homologada.

## SQL adicional y rollback

[Migración completa](../../../supabase/migrations/20261024213501_verifactu_integrity_report.sql): 3 funciones nuevas (helper privado, implementación privada, RPC pública), REVOKE/GRANT solo sobre ellas y **1 INSERT técnico en private.mfa_function_manifest**. No crea tablas; 0 ALTER/UPDATE/DELETE de facturas, recibos, líneas, cobros, series o archivos fiscales. No cambia RLS existente ni cohorte/factores MFA. lock_timeout=3s, statement_timeout=15s. Authenticated solo invoca wrapper con auth/owner/permiso sales/MFA; clientes sin EXECUTE en helpers.

[Rollback del monitor](rollback-monitor.sql) elimina solo esa entrada de manifiesto y las tres funciones, incluso después de uso fiscal; no elimina registros ni desactiva inmutabilidad. No ejecutar el rollback destructivo de fase1: la sombra ya tiene un evento. Para apagar captura sigue vigente disable-shadow.sql de fase1 conservando historia.

Activación del monitor, cuando se autorice su publicación: repetir recuentos/huellas y MFA, aplicar únicamente esta migración, comprobar cero findings/ACL, desplegar frontend revisado y abrir el modal en navegador real. Rollback: restaurar frontend compatible de fase1 y retirar la API nueva. Ningún PDF real obtiene QR al publicar este código: el interruptor real está cerrado y los llamadores normales no suministran la opción de preview.

## Fase 2: opción normativa y alcance

La leyenda VERI*FACTU corresponde al sistema que remite los registros, no a una captura local en sombra. Se elige **interruptor real cerrado**, sin QR ni leyenda añadidos a PDF reales durante noviembre/diciembre hasta aprobar el corte de conexión. No se activa NO VERI*FACTU como alternativa: queda fuera del alcance acordado. Los ejemplos muestran «PRUEBAS VERI*FACTU · NO REMITIDO · SIN VALIDEZ FISCAL», siempre con URL de pruebas.

QR vectorial 35×35mm, corrección M, zona de silencio de 4 módulos, antes del contenido de factura. Número ASCII32–126 hasta60 caracteres; NIF, fecha DD-MM-AAAA e importe decimal con punto; cuatro parámetros codificados, sin formato=json. Decodificación independiente desde el PNG renderizado del PDF prueba su contenido. Se rechaza un QR que no corresponda a los campos impresos.

Serializador offline alta/anulación desde snapshots y huellas guardadas. No recalcula un RF fiscal nuevo ni modifica el archivo. Revalida digest/canónico, identidad, instalación, anterior y alta original de anulaciones. Importes en céntimos BigInt; XML escapado; lote hasta1000. F1/F2 y R1–R5 S/I, referencia rectificada y base/cuota originales en S, secuencia inicial y registro anterior, datos de sistema e instalación. La anulación conserva el ID de la factura original, tipo01 y huella propia encadenada.

**Perfil fiscal soportado expresamente:** IVA general doméstico español (impuesto01/régimen01/S1) de snapshots taxable; varios tipos por factura y ajustes firmados. No inferir exención, OSS, IGIC, recargo o identificación extranjera desde texto libre. Esos casos y F3 sin lista de sustituidas se rechazan con error explícito antes de exportar: necesitan mapeo estructurado futuro, no reescritura ni recálculo silencioso. F1/R1–R4 exigen destinatario con NIF en snapshot; un RF sombra antiguo incompleto no se reclasifica a F2. La captura actual no se bloquea: no hay worker de envío conectado a este serializador.

14 XML sintéticos generados pasan los **XSD oficiales fijados por SHA-256** (incluye R1–R5 S/I y anulación). Pruebas negativas: campo obligatorio ausente, tipo u orden incorrectos, DOCTYPE/entidades. Los ocho contratos oficiales se volvieron a descargar estáticamente y coinciden: [reverificación](official-contract-recheck.json). No se modificaron los XSD para que pasaran. Validación XSD no es aceptación de las reglas de negocio/censo de AEAT.

Fuentes oficiales consultadas: [Orden HAC/1177/2024, arts.20–21](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2024-22138), [especificación QR v0.5.0](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf), [información técnica AEAT](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html). PDF QR/servicios/validaciones también descargados: coinciden con las tres huellas de fase0.

## Preparación fase 3

[Código de pasarela](../../../gateway/verifactu): Go1.27.3, crypto.Signer remoto KMS/HSM, RSA-PSS/SHA256, CRC32C de petición/respuesta, validación local de firma y correspondencia de clave pública/certificado. Solo clave versionada europe-west1 y protectionLevel=HSM; no PFX, JSON de credenciales ni claves privadas en memoria de la pasarela. Tokens cortos del runtime Cloud Run, nunca claves descargadas. Certificados sintéticos de las pruebas generados en memoria, sin persistir/loguear material.

mTLS local probado en TLS1.2 y1.3 contra servidor que exige certificado, usando el signer KMS simulado. Cliente solo endpoint PRUEBAS `prewww1.aeat.es/.../VerifactuSOAP`, SOAP1.1, sin redirecciones ni reintentos automáticos ambiguos; timeout, límite de2MiB, concurrencia1 por instancia. Gateway valida XSD oficial y NIF acotado antes del transporte. HTTP200 no se convierte en «aceptada»: entrega SOAP al futuro procesador de respuestas.

Docker arranca con VF_TEST_SEND_ENABLED=false. Habilitarlo requiere configuración explícita Cloud Run privado, clave HSM y cadena pública compatibles; ninguna ruta de producción AEAT ni despliegue automático existe. [Guía del propietario](google-cloud-owner-guide.md).

**Límite real:** no se realizó conexión autenticada con AEAT. El servicio oficial exige certificado electrónico cualificado reconocido y no hay uno de pruebas autorizado disponible; no se pidió. Las pruebas sintéticas locales no sustituyen esa prueba. Tampoco se probó hardware KMS real, IAM/WIF reales ni la custodia de un certificado real. Outbox persistente, tratamiento de respuestas/duplicados y reintentos requieren su fase de integración antes de habilitar envíos.

## Estado de entrega

Verificación local inicial del seguimiento: 1060 tests PASS/3 harness visuales opt-in (ejecutados expresamente cuando corresponde), build PASS; 15 pruebas SQL del monitor, tenant/MFA/rollback y 16 capturas sin overflow. Fase2: 30 tests QR/XML/PDF y 4 comprobaciones negativas/positivas XSD; QR decodificado desde PDF. Go test -race/vet locales correctos. El resultado final de CI y revisión independiente se anotará en el diario de esta entrega. **Detener antes de aplicar SQL/publicar cambios visibles: no se ha publicado el PDF con QR.**
