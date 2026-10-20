# Fase 2: ajuste de filtros y publicación autorizada

## Autorización y cambio

El propietario aprobó #263 el 20-10-2026, condicionando publicación al ajuste de FilterBar de escritorio. Se corrige el reparto flexible heredado en Facturación/Recibos y las columnas desiguales de Gastos. Búsqueda en fila propia, columnas iguales, controles 42 px, etiquetas y reset alineados, elipsis sin pérdida de opciones ni cambios de lógica.

## Evidencia

Capturas antes/después 1280/1440 en `design-phase2-filters-20261020/`, README con geometría y manifiestos. Se regeneran los nueve escenarios completos a 390/1280/1440, conservando cifras, filtros, acciones y selección. El guard geométrico falla sobre cc5562ae y pasa sobre la corrección; CI lo ejecuta dentro del harness existente. Suites locales/CI y despliegue se completan con recibo tras verificación, sin afirmar publicación anticipada.

## Rollback preparado antes de publicar

Vercel Gestión, proyecto `prj_L6nGgpq78QTEnZByUNtjtmF5rGkv`. Producción confirmada READY en `dpl_5KjeeSo3VSXSqNJjCPaNV4oNCRFP`, main `cfa6d3da52409d98216d696285e5f7862edb8939`, bundle `index-1XUnT9OV.js`, alias gestion.zenviacommerce.com. Revertir el merge de #263 mediante PR y CI, o rollback inmediato de Vercel a ese despliegue; volver a comprobar alias/bundle y sesión. Un rollback de Vercel suspende asignaciones automáticas hasta promoción posterior. Sin migraciones ni datos que revertir.

## Desviaciones

Recibos añade 54 px antes de lista en escritorio por separar la búsqueda; permanece en el primer pantallazo. El buscador de Gastos conserva su barra independiente. El test mide fixtures, no valida una sesión real del propietario; este comprobará en navegador tras el aviso. Shopify y MFA fuera del alcance.

## Verificación local previa al push

238 tests Vitest (44 ficheros), 1.222 tests Node de la misma selección que CI, build y guard de contrato pasan. El intento inicial de ejecutar indiscriminadamente todos los scripts incluyó el test exclusivo de Supabase local Auth/Vault: falló al no haberse iniciado su entorno efímero (RUN_LOCAL_AUTH_VAULT_TESTS), antes de cualquier conexión. La selección normal de CI lo excluye y se verifica por separado en su job real-auth-vault. No es error de producción; no se cambian Auth, Vault ni piloto. Harness corregido: nueve escenarios, cero fallos; los seis escenarios de escritorio fallaban con CSS de cc5562ae.
