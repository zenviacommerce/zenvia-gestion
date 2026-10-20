# Lote 2 publicado y comprobado · 20 octubre 2026

PR #266 aprobada por el propietario; CI completa verde en 1ff7afbaf5e594f4b4987a741a87a6e025da91c3 (build×2, Auth, Auth/Vault, capturas y Vercel). Fusionada como a03f10ca6e90f8d03765fbc4d90bba18bdee945d; producción READY dpl_AvXMo7EGoQY32WAgU2JGhQpb14cX, bundle index-lLeCVOf1.js. Incluye pluralización común de reembolsos, opciones y servicios y correcciones de fixtures antiguas. No SQL, Edge, Auth ni cambios de cálculo.

## Evidencia real y desviación

Lecturas DOM autenticadas en producción antes y después, sin pulsar Actualizar datos. Shopify: cinco tarjetas y todas las métricas coinciden exactamente (21:08:06Z → 21:10:00Z). Amazon: cinco tarjetas conservadas; ventas, pedidos y costes coinciden, pero NO hay igualdad completa: entre21:07:57Z y21:09:40Z reembolsos de Hoy12→13 y239,44→253,43€, mes104→105 y1791,50→1805,49€. También cambiaron ganancias y márgenes en Hoy/Ayer/Mes/pronóstico. Se adjuntan valores completos. No se atribuye con certeza el cambio a una causa sin evidencia adicional. La comparación con entradas sintéticas idénticas sí conserva cifras y las fuentes de cálculo analítico no cambian en el lote; por ello estas lecturas variables no prueban regresión y no se ejecuta rollback automático.

## Rollback preparado

Restaurar deployment anterior dpl_Aso26hWc9uXcmmcC5ppWpcMJFFys (main0d34847a567b7baf4ffeb54fba1c97ffa4a176d6, index-e22tGZwY.js). Alternativa: revert del merge a03f10ca mediante PR y CI. Sin datos que revertir. Lote3 permanece en rama de revisión, sin publicación.

[Valores y tiempos](design-phase3-commerce-release-20261020.json).
