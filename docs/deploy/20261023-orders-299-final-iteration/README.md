# Evidencia de la última iteración

No hay rollback ni cambios de datos/RPC en este corte. El propietario confirma #299 estable y pide una última iteración de hasta dos horas. El frontend se prepara para revisión y se avisa antes de publicar.

## Parámetros y método

Owner 7461b2b7-f383-460d-b1c7-6ccbb52e42b2. RPC públicas bajo rol authenticated y sesión AAL2 vigente del propietario, statement_timeout=8s. Los planes internos se explican con el mismo JWT y postgres, que es el propietario SECURITY DEFINER de las implementaciones. Se conservan EXPLAIN ANALYZE/BUFFERS en JSON sin filas de clientes.

- Pendientes workbench: p_from/p_to NULL, pending, página 0, 20 filas, filtros all y consulta vacía, orden orderDate/desc, overdue=24, staleDays=3.
- Enviados workbench: periodo 2026-10-01–2026-12-31, shipped; restantes parámetros iguales. 179 filas en el periodo, 20 por página, frente al contador global de 943 cuando no se limita el periodo.
- Pickup inicial realmente procede de OrderFinancialSummary: estado all, página 0 de tamaño 1, periodo del Resumen, filtros all. No es la página de Pendientes o Enviados. Esas dos pestañas tienen la misma llamada financiera inicial. Las consultas conservadas usan el trimestre vigente 2026-10-01–2026-12-31.
- Summary devuelve seis agregados operativos, con el mismo periodo de Resumen y pendientes globales.

## Resultado

RPC pública aislada: workbench Pendientes 148,975 ms; pickup financiero 120,004 ms; workbench Enviados 137,207 ms. SQL en paralelo: workbench 129,110 ms, pickup 114,397 ms, summary 51,946 ms. Son tiempos de ejecución de base de datos, no sustituyen el navegador real.

Plan interno workbench Pendientes: ejecución 100,783 ms y planificación 17,392 ms; comprobación de grupos obsoletos 27,868 ms, clasificado acumulado 46,394 ms, candidatos de tarifa 21,901 ms. Lectura de proyección 1.009 filas; sin lectura física ni escritura temporal en ese plan. Otros planes capturan un grupo transitoriamente obsoleto y el fallback de una fila, conservando la corrección durante ingestión.

Workbench Pendientes produce 293.254 bytes JSON: 285.176 bytes de 353 candidatos de tarifa y 7.305 bytes de página. No se cambia ese contrato aquí. Índices adicionales no resuelven la carga prematura de Resumen; los nodos de lectura de proyección son pequeños.

## Corrección preparada

App iniciaba page=dashboard y montaba Dashboard antes de resolver en useEffect la ruta/preferencia de entrada. Los efectos hijos arrancaban pickup y summary y seguían en curso tras cambiar a Pedidos. Una barrera de inicialización basada en estado React resuelve la página autorizada antes de montar los lectores de Resumen. El menú y el cierre de sesión siguen disponibles aunque las preferencias no terminen de cargar; una elección explícita permite abrir la sección autorizada sin esperar ese ajuste. Se conserva la carga de Resumen cuando se elige Resumen, la navegación por historial, la precedencia de permisos y la selección posterior de las páginas retenidas.

Prueba roja: cinco fallos por solicitudes prematuras (tres deep links, preferencia Pedidos y preferencias aún cargando). Tras corregir, 9 pruebas App y 20 pruebas de arranque/Resumen/modelo pasan; dos pruebas adicionales detectan una inicialización bloqueada al navegar por historial o usar el menú durante carga de preferencias. El hallazgo de revisión sobre disponibilidad queda cubierto por el caso de preferencias permanentemente pendientes. Suite local completa antes de ese caso adicional: 23 suites, 135 pruebas correctas. Build TypeScript/Vite e icono iOS correcto. CI completa del commit final pendiente al preparar este registro.

Rollback frontend: Instant Rollback al despliegue 6SnK6Aqbn62Ywr8psxc3G4iZeNBf, main 8bc47cfd6aa5e8bd4fd9e56d4741e37a82daf730, host zenvia-gestion-h2549vepl-sergiorojasdiaz-7097.vercel.app. No se requiere rollback SQL: no se modifica ninguna RPC en este corte. El rollback anterior de emergencia sigue preparado, pero el propietario ha ordenado no ejecutarlo por las mediciones actuales.

Aceptación: recarga real en Pendientes, Etiquetados y Enviados; no deberían arrancar pickup ni summary en los enlaces directos a Pedidos. Medir workbench y las llamadas realmente presentes, TTFB/descarga si el navegador lo permite, conservar contadores/filas/selección. No se afirma todavía <300 ms.
