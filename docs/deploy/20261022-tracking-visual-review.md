# Revisión visual de seguimiento — 22/10/2026

Revisión local sobre `feat/shipment-tracking-shadow`, con el [fixture sintético](../../scripts/shipment-tracking-screenshots.mjs). Las dos ejecuciones terminaron correctamente: seis combinaciones por conjunto (390, 1280 y 1440 px; claro y oscuro), sin errores JavaScript ni peticiones externas. No se publicó la UI ni se desplegó o modificó producción.

## Resultado visual

| Elemento | Resultado | Evidencia |
| --- | --- | --- |
| Columna Seguimiento completa | Siete estados visibles, sin recortes: Preparado (turquesa), En tránsito (azul), En reparto (ámbar), Entregado (verde), Incidencias (rojo), Devuelto y Cancelado (neutros) | [Claro 1440](20261022-tracking-review-v2/tracking-seven-states-light-1440.png), [oscuro 1280](20261022-tracking-review-v2/tracking-seven-states-dark-1280.png) |
| Fechas y avisos | `18/10/2026, 10:15`; aviso de cuatro días sin movimiento en estados activos; sin aviso en terminales | Mismas capturas de siete estados |
| Hora civil Envia | `21/10/2026 20:16:11 (zona no indicada)`; no se inventa zona horaria | Última fila de siete estados |
| Historial | Tres eventos con estado español, fecha/hora es-ES, texto y código original; orden más reciente primero | [Claro 390](20261022-tracking-review-v2/history-events-light-390.png), [oscuro 1440](20261022-tracking-review-v2/history-events-dark-1440.png) |
| Tarifas de transporte | Botón visible en cabecera móvil y escritorio | [Oscuro 390](20261022-tracking-review-v2/header-dark-390.png), [claro 1440](20261022-tracking-review-v2/header-light-1440.png) |
| Filtro Incidencias | Dos filas de incidencia, con columna, fecha y aviso visibles | [Claro 1440](20261022-tracking-review-v2/incidents-tracking-light-1440.png), [oscuro 1280](20261022-tracking-review-v2/incidents-tracking-dark-1280.png) |
| MRW sin acceso automático | Estado «Sin seguimiento disponible», fecha no disponible, última comprobación y enlace manual; historial vacío explícito | [Claro 390](20261022-mrw-unavailable-review/mrw-manual-link-light-390.png), [oscuro 390](20261022-mrw-unavailable-review/mrw-manual-link-dark-390.png), [claro 1440](20261022-mrw-unavailable-review/mrw-manual-link-light-1440.png) |

Las capturas anteriores de MRW móvil mostraban la parte superior del detalle y dejaban el enlace manual debajo del recorte. Las nuevas desplazan el detalle hasta el enlace. Las capturas anteriores del filtro Incidencias volvían al inicio horizontal de la tabla; las nuevas muestran expresamente Seguimiento.

## Reproducción

```bash
node scripts/shipment-tracking-screenshots.mjs
TRACKING_MRW_UNAVAILABLE=1 node scripts/shipment-tracking-screenshots.mjs
```

Los conjuntos locales generados contienen 44 y 56 PNG, respectivamente; este cambio versiona únicamente las capturas seleccionadas para revisión, no ambos conjuntos completos. Los manifiestos locales `after-manifest.json` registran las seis combinaciones, cero errores y cero peticiones externas. Las imágenes prueban presentación con datos sintéticos; no prueban acceso real a MRW ni estados de envíos de producción. Los indicadores comerciales del fixture son datos de apoyo y no validan cálculos de KPI.
