# Correo de informes · revisión del hotfix

Componente React y CSS reales de `@zenvia/ui`. Datos sintéticos y proveedor simulado; toda petición de red del navegador está bloqueada. No se envían correos ni se crean documentos reales. Fuente anterior: `c12d090` (idéntica a main en los archivos modificados).

| Flujo | Antes 390 | Después 390 | Antes 1440 | Después 1440 |
| --- | --- | --- | --- | --- |
| Reabrir formulario: copia por defecto | [Captura](before-copy-390.png) | [Captura](after-copy-390.png) | [Captura](before-copy-1440.png) | [Captura](after-copy-1440.png) |
| Resultado incierto y comprobación | [Captura](before-result-390.png) | [Captura](after-result-390.png) | [Captura](before-result-1440.png) | [Captura](after-result-1440.png) |
| Confirmación recuperada en Gmail | — | [Captura](after-reconciled-390.png) | — | [Captura](after-reconciled-1440.png) |

[Manifest y hashes](manifest.json). Revisados visualmente a 390 y 1440. Una sola llamada simulada de envío por escenario; comprobar el resultado no repite el envío. La copia se desmarca, se cierra y se vuelve a abrir para reproducir el defecto anterior.

Reproducir: `node scripts/pickup-mail-hotfix-review.mjs`. En este entorno utiliza `CODEX_PRIMARY_RUNTIME_NODE_MODULES` y Chromium local. No cambia el ancho de la aplicación.
