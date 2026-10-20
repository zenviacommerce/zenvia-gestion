# Fase 2 publicada: Facturación, Gastos y Recibos

Publicación autorizada por el propietario tras revisión de #263 y ajuste final de filtros. Comprobación pública: 20-10-2026 a las 20:48:59 Europe/Madrid (18:48:59 UTC).

## Cambios y estado confirmado

- #263 fusionada: main `ed63ce7aecff7c7a296b5fface372f89ee4b8bf7`; head probado `8cbebee27a4db28ef4c3edec1ca1a9b97833a245`. Árbol de producción idéntico al probado (`5331f890a0d38cb3d7d1943698b6ed4f3d3849e9`).
- Vercel Gestión `dpl_9RMFEKn4AhoTo738mzvfBbdqCURS`, proyecto `prj_L6nGgpq78QTEnZByUNtjtmF5rGkv`, READY en producción y alias `gestion.zenviacommerce.com` confirmado por API.
- HTML, JS y CSS públicos devuelven HTTP 200. Bundle `index-DlLrR06h.js`; CSS `index-BwE1Z53H.css`. CSS publicado incluye el grid y la elipsis de FilterBar. Esto verifica entrega del código; no es validación visual de una sesión autenticada.
- Facturación: búsqueda en fila propia; Cliente/País/Estado/Cobro con anchos iguales en una fila; controles de 42 px, etiquetas y Limpiar filtros alineados. Gastos y Recibos comprobados con la misma regla a 1280/1440. Opciones completas conservadas en los menús.
- Fase 2 completa: PageHeader/FilterBar/PageTabs comunes, KPI a dos columnas móvil, divisas de Gastos dentro de su tarjeta. Mismas cifras, filtros, acciones y selección de la revisión aprobada.

## Evidencia y CI

Seis checks de PR en verde antes del merge, incluido screenshots y real-auth-vault; Vercel success. Build de main posterior al merge también success. 238 Vitest, 1.222 scripts Node, build y guard de contrato locales pasan; nueve escenarios del harness sin fallos. La nueva comprobación falló sobre cc5562ae y pasa sobre el arreglo: detecta saltos de línea, filas, anchos desiguales, alturas y alineación de reset/búsqueda. Se conserva guard de acciones y prueba real de acceso a Tarifas. El detalle de checks/URLs/timestamps está en el [recibo JSON](design-phase2-filters-20261020/release-receipt.json).

[Capturas de filtros antes/después a 1280/1440 y medidas](https://github.com/zenviacommerce/zenvia-gestion/tree/main/docs/deploy/design-phase2-filters-20261020) · [Capturas completas a 390/1280/1440](https://github.com/zenviacommerce/zenvia-gestion/tree/main/docs/deploy/design-phase2-review-20261020).

Datos sintéticos, locale es-ES y red bloqueada. Primera lista móvil final: Facturación 1336,7 px, Gastos 1545,3 px y Recibos 1187,8 px (viewport 390×1000); todas <1800 px. Recibos aumenta 54 px en escritorio al separar búsqueda y conserva lista dentro del primer pantallazo. El buscador independiente de Gastos permanece en su propia fila.

## Rollback

Preparado y confirmado READY antes del merge: `dpl_5KjeeSo3VSXSqNJjCPaNV4oNCRFP`, main `cfa6d3da52409d98216d696285e5f7862edb8939`, bundle `index-1XUnT9OV.js`. Conserva Shopify, fase 1 y hotfixes de aviso/previews/Tarifas. Para emergencia, rollback de Vercel a ese despliegue y verificar alias/bundle; suspende asignaciones automáticas hasta promoción posterior. Alternativa: revertir el merge de #263 por PR y CI. No hay migraciones ni datos que revertir. No se ejecutó rollback.

## Desviaciones y límite

El intento local indiscriminado de todos los scripts incluyó el test exclusivo del entorno efímero Auth/Vault y falló antes de conectar por faltar su entorno; la selección CI normal pasó y el job real independiente también pasó. No fue error de producción. Sin cambios en Supabase, Edge, Auth, cohort o datos. La sesión real y el resultado visual en producción quedan para comprobación del propietario.

Este recibo se guarda en una rama solo de documentación para evitar otro despliegue de main.
