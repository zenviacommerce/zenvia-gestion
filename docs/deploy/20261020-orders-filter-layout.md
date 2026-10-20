# 2026-10-20 — Cabecera REC y filtros de Pedidos

## Causa y cambio
El th nuevo heredaba text-transform uppercase al no usar el botón compartido. Ahora usa SortableTableHeader, título «Informe de recogida», icono y aria-sort. Ordenación numérica REC por año y correlativo en servidor antes de paginar, ASC/DESC y sin informe al final. Nueva migración solo cambia implementación privada; wrapper público MFA y firma no cambian.

La barra flex de cinco filtros permitía que Transportista se partiera y creciera de 42 a 58 px (1280), desalineando etiquetas y controles. Grid por breakpoint con minmax(0,1fr), controles42px iguales, etiquetas alineadas, texto una línea con elipsis y flecha sin encoger. Estilos limitados a Orders.

## Evidencia
- 217/217 Vitest, 35 archivos; 1.135/1.135 Node. Build y TypeScript correctos.
- Test SQL: REC9999 frente10000, asc/desc entre páginas, vacíos al final, tenant/MFA existentes y rollback restaura hash exacto de la implementación.
- Test UI: dos clicks solicitan páginas globales asc/desc y aria-sort.
- Chromium: antes falla la regresión; después cero fallos a1280/1440/390, 15 controles de42px, sin desborde móvil, cabecera con icono/titlecase. [12 capturas antes/después](orders-filter-layout-review-20261020/README.md), fixture sintética y red bloqueada.
- Revisión independiente: sin hallazgos importantes; 20 tests verificados.

## Publicación autorizada y rollback
Usuario autoriza publicar este retoque tras CI verde. El reprocesado del sello es una tarea distinta en rama fix/company-stamp-ink, NO incluida ni autorizada para publicar aún.
Baseline Vercel: dpl_865SsMYiidQQqHowkRMYwJVw8e8C, index-bdctqdhl.js, commit af62a9f591be0132df012a4941e4fbeb5ed8b064. Preparar snapshot pg_get_functiondef de implementación privada antes de aplicar migración20261020102813. Rollback supabase/rollback/20261020_pickup_report_sort.sql probado; Instant Rollback frontend al deployment anterior.
Orden: snapshot+diario, migraciónsort/verificación authenticated, merge esperado delhead con cinco workflows verdes, VercelREADY+HTTPbundle, diariofinal. No se generan informes ni etiquetas.
