# Cierre documental/técnico de fase 0

23/10/2026. La fase 0 dispone de los entregables definidos para iniciar el núcleo, sin remisión AEAT ni emisión de facturas. #299 conserva su aceptación de rendimiento pendiente del propietario. Este ha autorizado publicar el frontend tras cerrar MFA y CI, para medir en su navegador real; permanece prohibida el alta de infraestructura fiscal hasta su indicación.

| Entregable de fase 0 | Evidencia |
|---|---|
| Alcance/SII | Confirmación del propietario: exclusivamente VERI*FACTU; no SII; sin otra validación del asesor para empezar |
| Inventario del obligado | 27 facturas estándar, series F/R activas 2026; agregados y hashes de puntos públicos en inventory.json |
| Impuestos actuales | 1 línea al 10% en 1 factura; 45 líneas al 21% en 26 facturas. Se conservan los tipos actuales; este inventario no sustituye las reglas fiscales del núcleo |
| Contratos y catálogo | WSDL, cinco XSD AEAT, XSD XMLDSig W3C y errores.properties oficiales fijados por tamaño/SHA-256; 247 códigos únicos. Bytes originales preservados, incluidos CRLF y codificación del catálogo |
| Especificaciones | Servicio 1.0.3, huella 0.1.2, QR y validaciones 1.2.2 identificados por URL y hash en official-specifications.json; PDFs descargados estáticamente para la revisión |
| Comprobación offline | verify_contracts.py: 8 archivos fijados, 6 XSD compilados y los 3 vectores oficiales SHA-256 pasan. Sin acceso a red durante la comprobación |
| Conservación y legado | retention-and-scope.md: separación fiscal/operativa, base mercantil 6 años con excepciones/holds, OSS 10 años cuando aplique, sin purga fiscal automática ni reconstrucción retroactiva de cadena |
| Custodia y alta | Decisión del propietario Google Cloud europe-west1/escala cero/no exportabilidad; plan de consola, IAM y WIF en google-cloud-owner-onboarding.md. Ningún recurso creado ni certificado importado |

No se declara todavía construido o validado el serializador, XML de facturas generadas, el núcleo transaccional, compatibilidad real HSM/mTLS ni el adaptador AEAT. Son entregables de fases posteriores con pruebas sintéticas, aprobación de corte y rollback; no se confunden los vectores de preparación con cumplimiento integral.

Siguiente corte autorizado: tras aceptación de #299, comenzar fase 1 con tests de numeración/idempotencia/aislamiento/mutabilidad y modelo privado de snapshots/cadena/outbox desactivada. Para el alta de Google se espera el momento posterior a #299/fase 0 indicado por el propietario; elegir proveedor no autoriza crear recursos ahora.
