# VERI*FACTU — base de fase 0 completada, fase 1 preparada

23/10/2026. Diseño aprobado por el propietario. Exclusivamente VERI*FACTU, no SII confirmado por el propietario; series e impuestos actuales. No se requiere otra confirmación del asesor para comenzar. Objetivo de la sociedad: 1/1/2027. Anotado OSS si se superan 10.000 € de ventas a distancia en la UE; no se modifica automáticamente la fiscalidad.

## Evidencia de fase 0

Inventario de solo lectura, limitado al owner del propietario: 27 facturas estándar sujetas a impuesto, 1 emitida y 26 cobradas; series F (estándar) y R (rectificativa), activas para 2026. No se consultaron aquí números de factura, NIF ni datos de clientes. El inventario anterior de 29 documentos era global del proyecto y no debe confundirse con este ámbito.

`inventory.json` conserva esos agregados y hashes de definición de los puntos públicos de emisión, reapertura, eliminación y rectificación, para detectar cambios durante el trabajo. Los hashes no sustituyen la auditoría de implementaciones privadas, triggers, cascadas y tareas de mantenimiento de fase 1.

Se descargaron los bytes del WSDL y cinco XSD desde la documentación pública oficial de AEAT; `contracts/manifest.json` registra URL, tamaño y SHA-256. Solo descargas estáticas: ninguna llamada SOAP, ni autenticación, certificado o factura. También se ha fijado el esquema de firma XML externo de W3C con SHA-256. Los seis XSD compilan sin acceso a red mediante un resolver de copias locales; esto valida la compilación del contrato, no todavía documentos de ejemplo ni la lógica fiscal. También se fijaron las especificaciones oficiales de servicio, QR y huella por URL/tamaño/SHA-256 en official-specifications.json. Los tres vectores oficiales de huella 0.1.2 pasan la comprobación SHA-256 sobre las cadenas canónicas transcritas. Esto prepara la fase 1; todavía no acredita un serializador fiscal, XML de facturas ni transporte AEAT. Se fijó también validaciones 1.2.2 y el catálogo oficial errores.properties, con 247 códigos únicos, y se documentó la matriz inicial de conservación en retention-and-scope.md. El cierre y sus límites están en acceptance.md.

## Primer corte de fase 1, después de #299

1. Auditoría de rutas actuales de escritura y cierre de mutabilidad de emitidas, también RPC antiguas, cascadas y mantenimiento; conservar cobros y estado comercial separados del snapshot fiscal.
2. Tests sintéticos que fallen antes de implementar: 20 emisiones concurrentes/idempotentes, rollback sin consumo indebido de número, cruce de tenant, mutaciones directas y cadena alta/anulación sin bifurcación. Nunca invocar emisión sobre datos reales.
3. Núcleo privado transaccional: obligado/instalación y cabecera de cadena bloqueada, numeración, idempotencia, snapshot inmutable, artefactos y outbox desactivada. No alterar series o impuestos actuales ni importar el legado a una cadena nueva.
4. Funciones de dominio y guardas con tests de los vectores oficiales fijados. Plan de migración y rollback exactos antes de producción; no conexión real AEAT ni custodia de certificados en esta fase.

Estimación de diseño vigente: fase 0, 1–2 días; fase 1, 4–6 días de ingeniería. Este inicio no equivale a declarar las dos fases terminadas. La implementación fiscal espera la aceptación de rendimiento de #299 para respetar el orden del propietario.

## Pasarela decidida por el propietario

El propietario ha elegido Google Cloud, europe-west1 (Bélgica), escalado a cero y clave privada no exportable en KMS/HSM. Se prepara el alta en google-cloud-owner-onboarding.md para que la ejecute personalmente después de #299 y fase 0. No se han creado recursos ni importado certificados. Esa elección no bloquea el inventario, contratos ni pruebas offline de fase 0.

## Comparativa histórica anterior a la decisión

Estimaciones de presupuesto de ingeniería, no ofertas ni contratación. Supuesto común: un obligado, ≤10.000 registros/mes, test y producción separados, tráfico pequeño y sin instancia dedicada siempre encendida. Importes mensuales aproximados en euros con margen de consumo; la factura puede ser en USD, con cambio e impuestos. Incluyen compute ligero, claves/secretos y logs/archivo modestos; excluyen NAT dedicado, firewall administrado, HSM dedicado y soporte empresarial.

| Opción | Región UE | Componentes y custodia | Presupuesto mensual |
|---|---|---|---|
| AWS | eu-west-1, Irlanda | Lambda + API Gateway; PFX cifrado en Secrets Manager mediante KMS, identidad mínima de runtime; S3 para archivo privado | 10–25 € |
| Google Cloud | europe-west1, Bélgica | Cloud Run con mínimo 0 + Secret Manager regional + Cloud KMS; Cloud Storage para archivo privado | 5–20 €; 20–45 € si se mantiene una instancia mínima caliente |

Esta comparación se conserva como antecedente. La selección está cerrada: Google Cloud en Bélgica. El plan vigente de Cloud HSM con clave no exportable, costes y consola está en google-cloud-owner-onboarding.md; la opción PFX cifrado de esta tabla no satisface por sí sola esa custodia. Confirmar compatibilidad HSM/mTLS en una prueba posterior, región de cada recurso, presupuesto y arquitectura de salida antes de contratar. El aislamiento estricto de red puede aumentar estos importes y requiere una cotización aparte.

En ambas, el certificado importado puede existir brevemente descifrado en memoria para mTLS; KMS/envelope encryption no lo convierte en una clave HSM no exportable. No exponer firma arbitraria, PFX, contraseña o claves al frontend, logs o base de datos de Gestión. Validar representación, rotación, revocación y recuperación antes de habilitar tráfico AEAT. Ninguna opción se ha contratado o desplegado.

Fuentes oficiales consultadas: [AWS Lambda](https://aws.amazon.com/lambda/pricing/), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/), [AWS KMS](https://aws.amazon.com/kms/pricing/), [Cloud Run](https://cloud.google.com/run/pricing), [Secret Manager](https://cloud.google.com/secret-manager/pricing), [Cloud KMS](https://cloud.google.com/kms/pricing). Los rangos son una estimación conjunta propia, no una tarifa publicada por esos proveedores.
