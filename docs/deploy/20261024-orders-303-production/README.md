# Pedidos: cierre aceptado por el propietario, 24-10-2026

PR #303 publicada con CI completa en verde. Main `0c7c202309482a90cc48cbf8169b79cee055f636`; Vercel `9h5KKoGo7y7BTXcL22286d5moB3i`, Ready / Current, publicación 05:59:14 UTC. El montaje oculto de Resumen ya no inicia pickup ni summary al entrar directamente en Pedidos.

El propietario verificó en su navegador real: solo inicia workbench; recarga completa en frío 884 / 588 / 471 ms (incluye conexión); cambios de pestaña en caliente Pendientes 307 ms, Incidencias 298 ms, Enviados 252 ms. Contadores y filas correctos. Aceptado por el propietario: rendimiento de Pedidos cerrado. No afirmar que toda carga fría es inferior a 300 ms.

Lección obligatoria: verificar SIEMPRE en el navegador real con las llamadas concurrentes reales de la pantalla; las medidas aisladas de RPC no bastan. La eliminación de competencia de peticiones resolvió el cuello de botella restante.

Rollback frontend preparado: commit `8bc47cfd6aa5e8bd4fd9e56d4741e37a82daf730`, Vercel `6SnK6Aqbn62Ywr8psxc3G4iZeNBf`, Instant Rollback disponible. #303 no cambió SQL.

VERI*FACTU fase 1 quedó pausada por la incidencia urgente de clasificación tras purga PII de Amazon; véase el diario vecino `20261024-orders-purge-logistics`.
