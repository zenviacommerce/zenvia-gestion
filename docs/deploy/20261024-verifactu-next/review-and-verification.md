# Revisión y verificación de entrega

Revisión independiente de toda la rama respecto de producción c9df8aa, tras suite local completa. Resultado inicial: 0 Critical/Important confirmados, 2 Minor. Antes de entregar se elevan ambos a relevantes para este contrato y se cierran en una sola pasada RED→GREEN:

1. Cabeza huérfana de cadena sin RF: SQL informa correctamente CHAIN_HEAD/sequence0, pero el decoder del cliente solo aceptaba secuencias positivas. El propietario veía desconocido en lugar de la corrupción confirmada. Test `preserves a confirmed orphan chain head at sequence zero as broken` falla antes y pasa después; sequence0 sigue rechazado para errores de registros ordinarios. No se cambia SQL ni se repara la cadena.
2. La CI especial no se disparaba en una futura modificación exclusivamente del servicio/modal/migración del monitor. Test Node `integrity implementation-only changes trigger the fiscal verification gate` RED→GREEN; se incorporan esas rutas al filtro. Los 3 harness visuales opt-in se ejecutan explícitamente en el gate visual: el nuevo monitor genera16 capturas además del circuito previo. No se quitan aserciones ni se omiten regresiones fiscales/MFA.

Decisiones técnicas tomadas y coste si fueran incorrectas:

- PDF real con interruptor cerrado hasta conexión/corte fiscal aprobados; solo preview sintética. Evita atribuir verificabilidad a sombra. Coste: no se prueba QR con clientes reales antes de la conexión.
- Serialización limitada al perfil IVA doméstico general estructurado; exenciones, extranjero, OSS o F3 sin metadatos se bloquean. Coste: esos casos requieren ampliar mapeo antes de remitirlos; no se inventan ni reescriben facturas.
- El monitor verifica integridad interna, no sustituye anclajes externos contra una reescritura privilegiada coherente completa. Coste: esa custodia requiere otra fase; no se anuncia homologación.
- HTTP200 de AEAT no implica aceptación de negocio; outbox/respuestas y reintentos no se activan. Coste: el código preparado no está conectado a emisiones naturales hasta completar esa integración.

Ningún hallazgo menor queda diferido. El único aviso de build es el tamaño de bundle preexistente; no se cambia la arquitectura por ese aviso.

Pruebas de preparación: mTLS TLS1.2/1.3 y circuito local completo XML/XSD→emisor→SOAP→mTLS con signer remoto simulado→respuesta, sin AEAT real. Certificado/CA sintéticos se generan en memoria. También mismatch clave/certificado, CRC32C, HSM/software, nombre de versión, padding/salt, nil signer options, XML profundo/DTD, emisor ajeno, redirect, sobrepeso y transporte desactivado. Go test -race/vet correctos; Docker se construye en CI (Docker no está disponible localmente).

Resultados completos y enlaces a la CI del SHA final se incluyen en la PR; esta anotación no sustituye sus resultados. Sin aplicación SQL, merge ni publicación de producción.
