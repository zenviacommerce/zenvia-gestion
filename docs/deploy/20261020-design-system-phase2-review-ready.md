# Fase 2 lista para revisión, sin publicar

Verificado 2026-10-20T16:22:11.912678+00:00.

- PR: https://github.com/zenviacommerce/zenvia-gestion/pull/263
- Head final: `cc5562aee5bd3cc870e7f696ad74a75d05ab35a4`; borrador=true, merged=false.
- Main/producción permanece en `cfa6d3da52409d98216d696285e5f7862edb8939` (hotfix264).
- Seis checks success y estado Vercel success, consultados para ese head final:

- Vercel Preview Comments · job 118743191020 · success · 2026-10-20T16:17:11Z
- auth-tests · job 118742840814 · success · 2026-10-20T16:18:20Z
- build · job 118742840592 · success · 2026-10-20T16:17:53Z
- build · job 118742839863 · success · 2026-10-20T16:17:19Z
- real-auth-vault · job 118742839509 · success · 2026-10-20T16:20:23Z
- screenshots · job 118742839359 · success · 2026-10-20T16:18:35Z

Local integrado:238 tests Vitest/44 ficheros,1222 scriptsNode, build y guard correctos. El guard de acciones compara cada cabecera de Facturación/Gastos/Recibos con before; el test real de acceso a Tarifas y la comparación Resumen/Pedidos forman parte de la CI heredada.

## Capturas y altura hasta la primera entrada

Se verificó la presencia remota de las18 capturas solicitadas: antes/después ×3 pantallas ×3 anchos. La carpeta tiene30 archivos, con manifiestos, oscuro móvil y segundo pantallazo. Datos sintéticos y red bloqueada; no se afirma validación visual de fase2 en producción.

[Carpeta completa](https://github.com/zenviacommerce/zenvia-gestion/tree/feature/design-system-phase2-20261020/docs/deploy/design-phase2-review-20261020) · [Galería](https://github.com/zenviacommerce/zenvia-gestion/blob/feature/design-system-phase2-20261020/docs/deploy/design-phase2-review-20261020/README.md)

| Pantalla | Ancho | Antes (px) | Después (px) |
|---|---:|---:|---:|
| Facturación | 390 | 2448 | 1349 |
| Gastos | 390 | 2293 | 1557 |
| Recibos | 390 | 1857 | 1204 |
| Facturación | 1280 | 1136 | 1133 |
| Gastos | 1280 | 1172 | 1130 |
| Recibos | 1280 | 912 | 879 |
| Facturación | 1440 | 1106 | 1087 |
| Gastos | 1440 | 1088 | 1097 |
| Recibos | 1440 | 912 | 862 |

Viewport de altura1000px. Todas las pantallas móviles cumplen<1800px. Cifras, divisas, controles, disabled y acciones coinciden con la referencia. Los tabs no desbordan. Selección tras filtrar/volver: Facturación/Gastos la vacían igual que antes; Recibos la conserva. No se añade cambio de alcance de selección en esta fase.

## Producción y rollback de una eventual fase2

`dpl_5KjeeSo3VSXSqNJjCPaNV4oNCRFP` READY, main `cfa6d3da52409d98216d696285e5f7862edb8939`, bundle `index-1XUnT9OV.js`. Conserva Shopify, fase1 y los hotfix de aviso/previews y Tarifas. No cambios SQL/Edge/Auth/datos; no rollback de datos.

## Entrega

DETENIDO antes de fusionar o publicar fase2, por instrucción del propietario. No empezar otra fase ni ampliar MFA. Este recibo posterior queda en rama solo docs para conservar el último head con CI verde sin provocar otra publicación de producción.
