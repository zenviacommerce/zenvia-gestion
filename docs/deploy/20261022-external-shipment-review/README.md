# Registrar envío externo · revisión antes de publicar

Datos sintéticos; pantalla real y componentes @zenvia/ui. No se ha modificado producción.

| Vista | 390 px | 1280 px | 1440 px |
|---|---|---|---|
| Antes | [Detalle](before-detail-light-390.png) | [Detalle](before-detail-light-1280.png) | [Detalle](before-detail-light-1440.png) |
| Después | [Detalle](after-detail-light-390.png) | [Detalle](after-detail-light-1280.png) | [Detalle](after-detail-light-1440.png) |
| Modal | [Formulario](after-modal-light-390.png) · [Confirmación](after-modal-confirmation-light-390.png) | [Formulario](after-modal-light-1280.png) | [Formulario](after-modal-light-1440.png) |
| Registrado | [Enviado](after-registered-light-390.png) · [Tracking](after-tracking-light-390.png) | [Enviado](after-registered-light-1280.png) | [Enviado](after-registered-light-1440.png) |
| Modal oscuro | [Formulario](after-modal-dark-390.png) · [Confirmación](after-modal-confirmation-dark-390.png) | [Formulario](after-modal-dark-1280.png) | [Formulario](after-modal-dark-1440.png) |

[Manifiesto de acciones conservadas](manifest.json). Capturas oscuras del detalle y registro también disponibles en este directorio. El formulario desplaza su contenido en móvil y conserva las acciones al pie.

Reproducir: `node scripts/external-shipment-review.mjs`, con Playwright disponible en el runtime y `EXTERNAL_CHROMIUM` apuntando al ejecutable de Chromium.
