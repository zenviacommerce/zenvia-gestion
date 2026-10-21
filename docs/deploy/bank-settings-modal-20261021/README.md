# Cuentas bancarias: lista y modales, revisión visual

El propietario autorizó publicar este ajuste después de Platform C, por separado. Se usa FormModal compartido, con lista y Añadir cuenta en reposo, alta/edición con Cancelar/Guardar y eliminación mediante confirmación real en modal. Se mantiene el guardado bancario independiente y los borradores de empresa.

**78 PNG a390/1280/1440 px**:18 antes y60 después, basadas en General y formularios/CSS reales, datos ficticios y red bloqueada. Después se validaron27 escenarios y105 capturas brutas antes de retener las60 más relevantes. Sin errores de navegador ni desbordamientos. No son pruebas autenticadas de producción.

La comparación buscada cambia expresamente la composición: desaparece el editor fijo y su fondo gris; el título/descripcion quedan dentro del mismo padding de sección que Documentos y aplicación; la lista adopta filas/badge/botones del sistema; el IBAN se agrupa4. Alta y edición pasan a modal (tres columnas en1280/1440, una en390). Las capturas de documentos cubren selección global/serie/manual y efectivo, con datos de selección distintos según estado; no se afirma igualdad de píxel entre estados con datos diferentes.

**Comprobación de estilos calculados a los tres anchos:** etiquetas bancarias y de General12px/peso800/mayúsculas/espaciado0.54px; inputs14px/peso400 y espaciado normal. Superficie accesible del modal dentro del viewport, sin contenedor semántico de altura cero. Se verifican cancelar sin mutación, editor hidratado, predeterminada al reabrir y confirmación real de eliminación. En factura/recibo/Shopify, selector en Fechas y cobro, visible con transferencia; efectivo lo oculta y volver a transferencia lo repone. Instantáneas de documentos conservan IBAN literal y no exponen selector.

**Validación final local:**64 archivos/323 pruebas Vitest correctas; build de producción correcto. Suite Node completa1244/1244 antes de la corrección semántica;48 contratos de Configuración/formularios después, más28 pruebas bancarias relevantes tras el arreglo de recarga y10 tras CSS. La CI remota se comprobará sobre el head final antes de fusionar. La revisión independiente final no deja hallazgos pendientes.

El caso de recarga fallida tras guardar conserva un aviso/reintento fuera del modal cerrado, sin repetir la creación. La normalización, IDs, defaults, snapshots, PDF/email y contratos financieros se conservan. No SQL/backend/Auth/MFA/dependencias ni documentos reales de prueba.

[Plan](plan.md) · [Rollback](preflight.md) · [Implementación y pruebas](implementation.md) · [Revisión independiente](review.md) · [Auditoría de otras colecciones](settings-collections-audit.md).

## Antes

| Pantalla / estado | 390 | 1280 | 1440 |
| --- | --- | --- | --- |
| general / bank-section | [390](before-general-390-bank-section.png) | [1280](before-general-1280-bank-section.png) | [1440](before-general-1440-bank-section.png) |
| general-missing / bank-section | [390](before-general-missing-390-bank-section.png) | [1280](before-general-missing-1280-bank-section.png) | [1440](before-general-missing-1440-bank-section.png) |
| invoice / payment | [390](before-invoice-390-payment.png) | [1280](before-invoice-1280-payment.png) | [1440](before-invoice-1440-payment.png) |
| receipt-new / top | [390](before-receipt-new-390-top.png) | [1280](before-receipt-new-1280-top.png) | [1440](before-receipt-new-1440-top.png) |
| shopify / top | [390](before-shopify-390-top.png) | [1280](before-shopify-1280-top.png) | [1440](before-shopify-1440-top.png) |
| series / edit-series | [390](before-series-390-edit-series.png) | [1280](before-series-1280-edit-series.png) | [1440](before-series-1440-edit-series.png) |

## Después

| Pantalla / estado | 390 | 1280 | 1440 |
| --- | --- | --- | --- |
| general / bank-section | [390](after-general-390-bank-section.png) | [1280](after-general-1280-bank-section.png) | [1440](after-general-1440-bank-section.png) |
| general / add-account | [390](after-general-390-add-account.png) | [1280](after-general-1280-add-account.png) | [1440](after-general-1440-add-account.png) |
| general / cancel-account | [390](after-general-390-cancel-account.png) | [1280](after-general-1280-cancel-account.png) | [1440](after-general-1440-cancel-account.png) |
| general / edit-account | [390](after-general-390-edit-account.png) | [1280](after-general-1280-edit-account.png) | [1440](after-general-1440-edit-account.png) |
| general / delete-confirmation | [390](after-general-390-delete-confirmation.png) | [1280](after-general-1280-delete-confirmation.png) | [1440](after-general-1440-delete-confirmation.png) |
| general-missing / bank-section | [390](after-general-missing-390-bank-section.png) | [1280](after-general-missing-1280-bank-section.png) | [1440](after-general-missing-1440-bank-section.png) |
| general-missing / add-account | [390](after-general-missing-390-add-account.png) | [1280](after-general-missing-1280-add-account.png) | [1440](after-general-missing-1440-add-account.png) |
| general-missing / cancel-account | [390](after-general-missing-390-cancel-account.png) | [1280](after-general-missing-1280-cancel-account.png) | [1440](after-general-missing-1440-cancel-account.png) |
| invoice / bank-series-default | [390](after-invoice-390-bank-series-default.png) | [1280](after-invoice-1280-bank-series-default.png) | [1440](after-invoice-1440-bank-series-default.png) |
| invoice / bank-manual-override | [390](after-invoice-390-bank-manual-override.png) | [1280](after-invoice-1280-bank-manual-override.png) | [1440](after-invoice-1440-bank-manual-override.png) |
| invoice / cash-no-bank | [390](after-invoice-390-cash-no-bank.png) | [1280](after-invoice-1280-cash-no-bank.png) | [1440](after-invoice-1440-cash-no-bank.png) |
| receipt-new / bank-manual-override | [390](after-receipt-new-390-bank-manual-override.png) | [1280](after-receipt-new-1280-bank-manual-override.png) | [1440](after-receipt-new-1440-bank-manual-override.png) |
| receipt-new / cash-no-bank | [390](after-receipt-new-390-cash-no-bank.png) | [1280](after-receipt-new-1280-cash-no-bank.png) | [1440](after-receipt-new-1440-cash-no-bank.png) |
| shopify / bank-series-default | [390](after-shopify-390-bank-series-default.png) | [1280](after-shopify-1280-bank-series-default.png) | [1440](after-shopify-1440-bank-series-default.png) |
| shopify / bank-manual-override | [390](after-shopify-390-bank-manual-override.png) | [1280](after-shopify-1280-bank-manual-override.png) | [1440](after-shopify-1440-bank-manual-override.png) |
| shopify / cash-no-bank | [390](after-shopify-390-cash-no-bank.png) | [1280](after-shopify-1280-cash-no-bank.png) | [1440](after-shopify-1440-cash-no-bank.png) |
| invoice-edit-snapshot / bank-readonly-snapshot | [390](after-invoice-edit-snapshot-390-bank-readonly-snapshot.png) | [1280](after-invoice-edit-snapshot-1280-bank-readonly-snapshot.png) | [1440](after-invoice-edit-snapshot-1440-bank-readonly-snapshot.png) |
| receipt-edit-snapshot / bank-readonly-snapshot | [390](after-receipt-edit-snapshot-390-bank-readonly-snapshot.png) | [1280](after-receipt-edit-snapshot-1280-bank-readonly-snapshot.png) | [1440](after-receipt-edit-snapshot-1440-bank-readonly-snapshot.png) |
| shopify-snapshot / bank-readonly-snapshot | [390](after-shopify-snapshot-390-bank-readonly-snapshot.png) | [1280](after-shopify-snapshot-1280-bank-readonly-snapshot.png) | [1440](after-shopify-snapshot-1440-bank-readonly-snapshot.png) |
| series / series-bank-default | [390](after-series-390-series-bank-default.png) | [1280](after-series-1280-series-bank-default.png) | [1440](after-series-1440-series-bank-default.png) |

## Reproducir

```sh
BANK_CAPTURE_BASELINE=d2c3e00d5f3574a603a3267cfa13e9029610c456 BANK_CAPTURE_OUTPUT=docs/deploy/bank-settings-modal-20261021 BANK_CAPTURE_SCREENS=general,general-missing,invoice,receipt-new,shopify,series node scripts/bank-settings-modal-screenshots.mjs before
BANK_CAPTURE_BASELINE=d2c3e00d5f3574a603a3267cfa13e9029610c456 BANK_CAPTURE_OUTPUT=docs/deploy/bank-settings-modal-20261021 BANK_CAPTURE_SCREENS=general,general-missing,invoice,receipt-new,shopify,invoice-edit-snapshot,receipt-edit-snapshot,shopify-snapshot,series BANK_LAYOUT_REVIEW=1 node scripts/bank-settings-modal-screenshots.mjs after
```

El commit nativo del baseline reconstruido tiene exactamente el árbol GitHub923fecaf2a5a859c3d86e4b06efcabceaee7da72 de e20260e9540debb368ed19a461e2a0c7ff9bcfab. En un clon normal se puede usar directamente ese commit remoto como BANK_CAPTURE_BASELINE. El arnés requiere las herramientas de captura Playwright/esbuild/Chromium ya disponibles en el entorno de revisión; no se añadieron dependencias al producto. Los manifiestos registran hashes de fuentes, CSS, JS, fixture y capturas.

## Otras colecciones

La regla lista+modal queda en docs/design-system.md. Se revisaron cinco excepciones existentes: métodos de pago, reglas de envío, formatos de paquete, pesos por SKU y alias de proveedores. Se registra su migración posterior, conservando su guardado diferido o inmediato respectivo. No se convierten dentro de este ajuste bancario; el coste es mantener temporalmente esas excepciones. Los ajustes escalares, toggles y líneas de documentos no son colecciones de Configuración sujetas a esta conversión.
