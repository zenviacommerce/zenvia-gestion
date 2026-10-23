# Revisión: firma verificable y estado logístico

**SIN PUBLICAR.** Componentes reales, datos y documentos sintéticos, red bloqueada. Las respuestas de transportista y persistencia se simulan en el navegador; las transiciones, permisos, migración y rollback se prueban aparte con SQL ejecutado en PGlite. No se firma ni se emite ningún documento real.

110 capturas: 32 de comparación de Pedidos/Informes, 66 del flujo completo y 12 de Resumen. Claro/oscuro; flujo y Resumen a 390/1440/2560. Comparación de ancho adicional a 1920.

## Flujo completo

| Paso | 390 claro | 1440 claro | 2560 oscuro |
|---|---|---|
| Pendientes | [Ver](flow/01-pending-390-light.png) | [Ver](flow/01-pending-1440-light.png) | [Ver](flow/01-pending-2560-dark.png) |
| Etiqueta creada y confirmada al canal → Etiquetados | [Ver](flow/02-labelled-390-light.png) | [Ver](flow/02-labelled-1440-light.png) | [Ver](flow/02-labelled-2560-dark.png) |
| Verificar envíos antes de firmar | [Ver](flow/03-verification-390-light.png) | [Ver](flow/03-verification-1440-light.png) | [Ver](flow/03-verification-2560-dark.png) |
| Retirada con motivo y totales recalculados | [Ver](flow/04-removed-390-light.png) | [Ver](flow/04-removed-1440-light.png) | [Ver](flow/04-removed-2560-dark.png) |
| Ver PDF antes de firmar | [Ver](flow/05-pdf-before-sign-390-light.png) | [Ver](flow/05-pdf-before-sign-1440-light.png) | [Ver](flow/05-pdf-before-sign-2560-dark.png) |
| Todos comprobados y firma preparada | [Ver](flow/06-ready-390-light.png) | [Ver](flow/06-ready-1440-light.png) | [Ver](flow/06-ready-2560-dark.png) |
| Informe firmado | [Ver](flow/07-signed-390-light.png) | [Ver](flow/07-signed-1440-light.png) | [Ver](flow/07-signed-2560-dark.png) |
| Retirado permanece en Etiquetados | [Ver](flow/08-removed-stays-labelled-390-light.png) | [Ver](flow/08-removed-stays-labelled-1440-light.png) | [Ver](flow/08-removed-stays-labelled-2560-dark.png) |
| Los demás pasan a Enviados | [Ver](flow/09-shipped-390-light.png) | [Ver](flow/09-shipped-1440-light.png) | [Ver](flow/09-shipped-2560-dark.png) |
| Salida manual individual | [Ver](flow/10-individual-confirm-390-light.png) | [Ver](flow/10-individual-confirm-1440-light.png) | [Ver](flow/10-individual-confirm-2560-dark.png) |
| Salida manual masiva | [Ver](flow/10-manual-confirm-390-light.png) | [Ver](flow/10-manual-confirm-1440-light.png) | [Ver](flow/10-manual-confirm-2560-dark.png) |

[PDF sintético firmado](flow/signed-synthetic.pdf) · [Inventario de controles y pruebas del flujo](flow/manifest.json) · [Comparación de ancho/buscador/acciones](comparison.json)

La prueba de cambio de workspace retrasa la lectura de selección, cambia el workspace y libera la respuesta anterior: el modal no reaparece. La prueba de firma retira una línea, revisa el PDF y firma únicamente las restantes. La cámara queda para fase 2.

## Resumen

El KPI Enviados usa la misma regla que Pedidos. Caso sintético: 23 comerciales frente a 14 salidas físicas.

| Ancho | Antes claro | Después claro | Después oscuro |
|---|---|---|
| 390 | [Ver](summary/before/summary-390-light.png) | [Ver](summary/after/summary-390-light.png) | [Ver](summary/after/summary-390-dark.png) |
| 1440 | [Ver](summary/before/summary-1440-light.png) | [Ver](summary/after/summary-1440-light.png) | [Ver](summary/after/summary-1440-dark.png) |
| 2560 | [Ver](summary/before/summary-2560-light.png) | [Ver](summary/after/summary-2560-light.png) | [Ver](summary/after/summary-2560-dark.png) |

## Comparación de Pedidos e Informes

| Pantalla y ancho | Antes claro | Después claro |
|---|---|---|
| orders · 390 | [Ver](before/orders-390-light.png) | [Ver](after/orders-390-light.png) |
| orders · 1440 | [Ver](before/orders-1440-light.png) | [Ver](after/orders-1440-light.png) |
| orders · 1920 | [Ver](before/orders-1920-light.png) | [Ver](after/orders-1920-light.png) |
| orders · 2560 | [Ver](before/orders-2560-light.png) | [Ver](after/orders-2560-light.png) |
| reports · 390 | [Ver](before/reports-390-light.png) | [Ver](after/reports-390-light.png) |
| reports · 1440 | [Ver](before/reports-1440-light.png) | [Ver](after/reports-1440-light.png) |
| reports · 1920 | [Ver](before/reports-1920-light.png) | [Ver](after/reports-1920-light.png) |
| reports · 2560 | [Ver](before/reports-2560-light.png) | [Ver](after/reports-2560-light.png) |
