# Cuentas bancarias: revisión visual offline

81 capturas entregadas en 390, 1280 y 1440 px: 21 antes y 60 después. La selección reduce 180 capturas verificadas sin omitir escenarios ni fallos; conserva una toma enfocada por escenario/anchura y una segunda sólo para el editor de cuentas o para comparar la cuenta de serie con el override manual. El recibo completo y las 180 tomas originales permanecen localmente fuera del repositorio.

## Origen y aislamiento

Antes: referencia inmutable `95891f9816313bfe11b7b910593689e267e200c5`, leída mediante `git show` para todas las fuentes TS/TSX/CSS de `src` y `packages/ui/src`. Después: árbol de trabajo con la nueva interfaz. Cada manifiesto contiene SHA-256 de fuentes, CSS, JS, fixture y de las capturas entregadas existentes. General se recapturó tras los últimos ajustes de límites de campos y sincronización del editor al cambiar la predeterminada; `captureBatches` conserva el bundle y las fuentes exactas de cada lote. Los otros 45 formularios no consumen ese panel y sus fuentes mostradas no cambiaron.

Componentes reales: `GeneralSection` de Settings, `InvoiceModal`, `ReceiptModal`, `OrderInvoiceModal`, `SeriesManagerModal`, `Sidebar` y `SettingsProvider`, junto con formularios, selectores, helpers y tema reales. General se exporta únicamente dentro del bundle de captura para montarlo aislado; no se modifica su implementación ni se navegan secciones de seguridad. El contenedor reproduce sidebar y página, sin montar el App monolítico.

CSS completo del grafo transitivo de `main`/`App`, procesado por esbuild: 58 imports directos recopilados, 60 fuentes CSS resueltas antes y 61 después al añadirse la hoja bancaria; `@zenvia/ui` siempre se resuelve a sus fuentes. No hay sustitución de CSS por vacío.

El reloj se fija al 21 de octubre de 2026 UTC, idioma `es-ES`, animaciones/transiciones desactivadas antes de montar y red externa bloqueada. Todo dato de empresa, cliente y documento es sintético. Los IBAN ES, DE y GB son ejemplos públicos de prueba de formato/checksum. No se consultaron datos bancarios reales.

Se simulan exclusivamente las fronteras de carga/persistencia, branding, PDF y avisos. El cambio de predeterminada actualiza sólo el fixture en memoria. No se guardan, emiten, numeran, descargan PDF ni envían documentos reales; las llamadas no previstas lanzan error. Estas capturas validan UI offline y no sustituyen una prueba E2E de producción ni las pruebas de servidor/PDF.

## Escenarios y comprobaciones

| Superficie | Evidencia antes | Comprobaciones después |
|---|---|---|
| Configuración General | Campo IBAN único | Dos cuentas, cambio de predeterminada en memoria, editor cargado y checkbox de predeterminada sincronizado tras cambiar a otra cuenta |
| General sin cuentas | Sin gestor múltiple | Estado vacío y alta disponible |
| Factura manual nueva | Forma de pago sin selector bancario | Default global, default de serie y selección manual conservada al cambiar de serie |
| Borrador existente | Editor estándar | Mantiene la cuenta persistida |
| Factura sin cuenta | Sin selector | Aviso exacto y enlace a Configuración General |
| Cuenta de borrador archivada | Sin validación bancaria visible | Aviso de selección no disponible; no sustitución silenciosa |
| Factura con snapshot | Sin snapshot bancario | Sólo lectura; conserva DE original aunque la cuenta viva sea GB y esté archivada |
| Factura legacy_current_render | Sin procedencia visible | Aviso de que los datos conservados no acreditan la cuenta original de emisión |
| Factura legacy_missing | Sin procedencia visible | Mantiene ausencia de datos; no toma la cuenta viva |
| Recibo nuevo | Sin banco documental | Default global y selección manual |
| Recibo nuevo sin cuenta | Sin control bancario | Aviso exacto y enlace a General |
| Recibo existente | Editor estándar | Snapshot sólo lectura; no selector vivo, también tras modificar/archivar la cuenta viva |
| Shopify | Formulario real sin banco | Default global/serie, override conservado y ausencia con aviso |
| Shopify emitida | Sin detalle bancario | Snapshot sólo lectura sin selector vivo |
| Series | Editor sin banco | Carga la cuenta de la serie y permite default global nullable |

En las tres anchuras se rechazan errores de página y overflow horizontal del documento. Se comprueban las opciones y acciones de los formularios originales y los campos añadidos. Las verificaciones completas corren antes de la curación; `captureValidation.allStates` registra los estados verificados y `captures` sólo lista entregables existentes.

## Capturas de referencia

- General móvil: [antes](before-general-390-bank-section.png), [dos cuentas y nueva predeterminada](after-general-390-global-default-changed.png), [editar cuenta](after-general-390-edit-account.png).
- Factura: [antes](before-invoice-1280-payment.png), [default de serie](after-invoice-1280-bank-series-default.png), [override manual](after-invoice-1280-bank-manual-override.png).
- [Aviso sin cuenta móvil](after-invoice-missing-390-missing-bank-warning.png).
- [Recibo con cuenta conservada](after-receipt-edit-snapshot-1280-bank-readonly-snapshot.png).
- [Procedencia legacy](after-invoice-edit-legacy-1440-bank-readonly-snapshot.png) y [legacy sin cuenta](after-invoice-edit-legacy-missing-1440-bank-readonly-snapshot.png).
- [Shopify con override](after-shopify-1440-bank-manual-override.png), [Shopify sólo lectura](after-shopify-snapshot-1440-bank-readonly-snapshot.png), [cuenta de serie](after-series-1440-series-bank-default.png).

## Reproducción

Desde la raíz del repositorio, con las herramientas offline disponibles en `/workspace/scratch/209f463fbd52/ui-extraction/node_modules`:

```sh
node scripts/bank-account-screenshots.mjs before
node scripts/bank-account-screenshots.mjs after
```

El script captura y valida los 180 estados, conserva el recibo completo fuera del repositorio y aplica la misma selección de 81 PNG de forma reproducible. Los manifiestos `before-manifest.json`, `after-manifest.json` y `manifest-comparison.json` documentan los resultados y sus límites.

## Revisión de fuentes tras integrar cambios independientes

`manifest-source-final-vs-capture.json` compara las 287 fuentes registradas con el árbol final. Coinciden 285, incluido `App` y toda la UI/CSS bancaria. Sólo cambiaron posteriormente `Products.tsx`, que no se monta en estas siete superficies, y `salesInvoicePdf.ts`, frontera simulada que no se ejecuta en el harness. La coordinación verificó por separado Productos y el ajuste PDF de una página con IBAN/BIC/titular y legacy exacto.

No se recapturaron ni reescribieron los hashes originales de fuente: cada lote conserva su procedencia exacta. Los 81 hashes PNG siguen coincidiendo. Los PDF y sus propias figuras de revisión están fuera del alcance de este manifiesto y no se cuentan como capturas bancarias.
