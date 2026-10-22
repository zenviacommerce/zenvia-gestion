# Validación de la rama

Estado: revisión previa a publicación. Producción y base de datos sin cambios.

| Comprobación | Resultado local |
|---|---|
| `npm test` | 98 archivos, 523 pruebas correctas; 0 fallos |
| Suite Node de CI (`scripts/*.test.mjs`, excluyendo integración MFA real) | 1.280 pruebas correctas; 0 fallos |
| `npm run build` | Compilación TypeScript, paquete UI y bundle de producción correctos; verificación de icono iOS correcta |
| Revisión independiente | Dos defectos corregidos: entrada Pendientes en página retenida y denominación EUR; segunda revisión sin P1/P2 nuevos |
| Ajuste final del texto móvil Actualizar | 21 pruebas operativas + 8 contratos Node correctos |
| Precisión del alcance de ventas/costes en Resumen | 11 pruebas financieras correctas |
| SQL | Ejecutada únicamente en PGlite de pruebas; casos de proyección legado/activa/desactivada/sucia, permisos, MFA, tenant, fechas, filtros, selección y contadores |
| Producción | Migración no aplicada; frontend no publicado; sin compras, facturas, pedidos ni informes reales nuevos |

Los avisos de tamaño de bundle de Vite permanecen; no son errores de compilación. La CI remota se enlaza en el borrador de PR. Las capturas verifican layout con datos sintéticos y componentes reales; no prueban periféricos de impresión ni credenciales reales.

## Defectos corregidos durante la revisión

- Sincronizar la página Pedidos retenida con una navegación aceptada a Pendientes o un enlace a otra pestaña; limpiar filtros en la entrada desde el KPI Pendientes de Resumen.
- Conservar EUR para agregados que son EUR, aunque la moneda general elegida sea distinta.
- Renderizar las filas elegibles devueltas por el servidor, sin descartarlas por un segundo filtro local incompatible con fechas nulas o búsquedas en identificadores de producto.
- Incluir el umbral de días sin movimiento en la revisión de selección, descartando respuestas obsoletas.
- Usar la misma fecha real/civil Madrid para Incidencias y avisos visibles; no inventar movimiento desde la creación de la etiqueta o su última consulta.
- Mantener todas las acciones de cabecera accesibles en móvil sin desbordar el menú; ajustar contraste de etiquetas y enlaces en tema oscuro.
- Introducir una versión de preferencias que haga visibles los cuatro KPI nuevos en selecciones antiguas, sin restaurar tarjetas antiguas ocultas ni sobrescribir elecciones posteriores.

La antigua captura de fase 1 esperaba las tarjetas KPI en Pedidos. El flujo visual de CI pasa a ejecutar las 42 capturas del workbench y sus pruebas de acciones/selección/finanzas; conserva MFA y las fases del resto de pantallas. El navegador utiliza Playwright instalado en CI y una ruta local opcional mediante `WORKBENCH_CHROMIUM_ROOT`.
