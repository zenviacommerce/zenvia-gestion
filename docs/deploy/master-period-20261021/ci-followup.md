# CI y alcance de paridad — 2026-10-21

PR #273, primer head c90bc92e. Build principal #2319, Build check #629, Auth #298 y MFA desechable #337 verdes. El piloto MFA de producción no se toca.

Dos fallos de expectativas anteriores al cambio aprobado: Shared UI #3 compara todas las pantallas actuales con la extracción de octubre y detecta exclusivamente cuatro PNG de Productos; el workflow visual general #152 rechaza únicamente los dos textos KPI aclarados, en las tres anchuras. Valores, variantes, acciones, opciones, selección y geometría pasan. Logs inspeccionados, no atribuidos a un fallo de producto sin evidencia.

Corrección: contratos del paquete siempre se ejecutan; pixel parity estricta se reserva a cambios de packages/ui, dependencias, adaptadores y loader/harness de extracción, o ejecución manual. No congelar pantallas de producto posteriores a la extracción. No se agregan máscaras ni tolerancia de píxeles.

El comparador general de maestros normaliza exclusivamente «Productos visibles» → «Productos en periodo» y «de N visibles» → «de N en el periodo» para Productos. Números, periodo y demás textos continúan comparándose completos; test demuestra que coste o cantidad distintos siguen fallando y que Clientes no recibe esa normalización. Los 48 PNG propios de este arreglo y sus regresiones verifican el cambio solicitado.

Verificación focal local: contratos paquete 3/3 y comparador 1/1; nueve casos del selector de alcance pasan. Recorrido completo de maestros antes/después se repite antes de integrar. La CI final se registrará tras este follow-up.

Revisión independiente previa: sin bloqueantes; confirmó fuentes, CSS y 48 hashes, y ejecutó las cinco regresiones React. Rollback preparado antes de publicación: deployment dpl_Bn7hL8R6vYWkqefn8qsud3ARhfvy / main5e90cb6fc6e1997ca4dd3376e3c6e15e06573699. No SQL ni Edge.

Recorrido final local completo de maestros: 9 before + 9 after verdes a390/1280/1440, incluidas selección, opciones, ordenación y acciones. El DOM textContent concatena etiqueta/valor sin espacios; la regresión cubre ese formato real y conserva estrictamente valores y periodo.
