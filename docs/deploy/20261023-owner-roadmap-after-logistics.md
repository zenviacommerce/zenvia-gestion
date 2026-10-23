# Hoja de ruta del propietario tras #297

Decisión del propietario23/10/2026. Sustituye el orden del backlog de Gestión desde este punto. Registrar requisitos no autoriza implementaciones fiscales ni envíos reales.

## Orden vigente

1. Reconciliación automática de envíos colgados: recuperar revisión de casos límite, sin activar antes de validar. Consulta por referencia al transportista para *_CREATING antiguos; recuperar o liberar. Acción «Comprobar con MRW» y diagnóstico útil.
2. Rendimiento real de RPC Pedidos: conservar métricas de24,9h tras #280/#281 y reducción~70%; pendientes workbench, pickup fallback/grupos sucios, medición DO, lookup asin y cleanup. Objetivo RPC<100ms, medir antes y después.
3. VERI*FACTU + rectificativas completas: **primero diseño técnico para revisión; detenerse con el diseño**, sin implementar.
4. Facturación automática Shopify sobre el núcleo VERI*FACTU.
5. Presupuestos y albaranes no fiscales, convertibles a albarán/factura con una acción.
6. Resto del backlog Gestión: cancelar Envia/Sendcloud/MRW; comprobar bug Cancelado derivado de texto; papelera con diseño previo; Sin coste; Amazon Mes anterior; token propio Amazon.
7. Platform: Usuarios y Auditoría bajo Administración, misma estructura y permisos, pestañas compartidas, capturas y detenerse antes de publicar.

## Requisitos para el diseño VERI*FACTU

Urgencia expresada por el propietario: sociedad ZENVIA COMMERCE SL y requisitos como fabricante para vender el software. El propietario cita1/1/2027, RDL15/2025, Reglamento y Orden HAC/1177/2024; contrastar esas referencias y su aplicación al negocio. Contrastar vigencia, ámbito, exclusión SII y plazos con BOE/AEAT al elaborar el diseño; la fecha y referencia normativa aportadas son un requisito a verificar, no un dictamen jurídico de este registro.

- Modalidad VERI*FACTU con remisión AEAT salvo decisión distinta del asesor; confirmar obligado fuera del SII.
- Registros de alta/anulación, encadenamiento SHA-256 según especificación, eventos, inalterabilidad, trazabilidad y conservación.
- QR/leyenda del PDF; AEAT en pruebas primero; respuestas, errores, reintentos y subsanaciones.
- Emitidas inmutables. Eliminar solo borradores. Correcciones por rectificativas R1-R5, sustitución/diferencias, o anulación registrada. Rectificativas completas en Facturación.
- El propietario dispone del certificado de la sociedad. Diseñar subida segura por el propietario y rotación; Vault o servicio de firma aislado. Nunca pedir certificado/contraseña por chat, guardarlo en repo ni exponerlo al frontend.
- Declaración responsable del producto; cada tenant con obligado y certificado propios.
- Fases, estimación y riesgos. Entregar diseño técnico y esperar revisión antes de implementar.

## Facturación automática Shopify

Configuración→Facturación→Shopify: Manual/Automática y prueba que crea borradores. Trigger al generar etiqueta o enviarse; completa si checkout tiene NIF/empresa, simplificada si no; serie propia; idempotencia de una factura por pedido; total no coincidente bloquea a borrador. Cancelaciones/devoluciones crean rectificativa en borrador; resumen diario.

Entrega obligatoria por ambas vías: A) enlace seguro en metafield del pedido y botón Descargar factura en confirmación de envío Shopify; B) correo Gmail desde Zenvia con marca y PDF adjunto. Contemplar OSS UE y consentimiento de factura electrónica. No emitir facturas/documentos reales en pruebas.

## Restricciones conservadas

MFA piloto de info@zenviacommerce.com intacto; cierre/ampliación pendientes de tarea separada. No tocar PayPal ni suscripciones reales. Persisten SP-API público, validación Amazon, PayPal live y asistente por transportista como pendientes posteriores; no adelantarlos a los bloques anteriores.

Reglas de ejecución: evidencia antes de afirmaciones; estimación por paso; rollback antes de producción; diario docs/deploy; recuento previo a cualquier migración/reprocesado; SQL exacto y filas antes de aprobación destructiva; UI @zenvia/ui + docs/design-system.md, pruebas de inventarios/búsquedas/filtros/ancho y capturas390/1440/2560 cuando corresponda. Detenerse antes de publicar cambios visibles sin autorización expresa.
