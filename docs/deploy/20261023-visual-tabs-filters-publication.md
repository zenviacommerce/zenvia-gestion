# Recibo del hotfix visual · 23/10/2026

Estado: PUBLICADO y comprobado en producción en ambas aplicaciones.

## Alcance autorizado

Pestañas a ancho completo, búsquedas compartidas, filtros de Soporte y tarjetas de informes. Sin SQL, Edge Functions, cron, purgas, firmas o correos reales, ni cambios en la confirmación Amazon/Shopify. La decisión posterior sobre estado logístico se conserva en `20261023-owner-next-logistics-state.md` y requiere revisión antes de publicar.

## Fuentes candidatas

- Gestión PR296: `31c94ec6248ec6e5d9f389261a2c786f5bc41dc7`.
- Platform PR83: `c998dffba2c3cb3e5c3f4af3f23d2921252e1c0e`.
- Galerías: Gestión 72 pares; Platform 24 pares; 390/1440/1920/2560, claro/oscuro.
- Local: Gestión 685 Vitest y 1291 Node, build; Platform 318 Node, build. Nuevo test de inventario estricto y 9 inventarios reales financieros correctos. Revisión independiente final sin hallazgos.

## Antes en producción, lectura a 2560 px

- Facturación: panel 1594.203125 px frente a 2221 disponibles.
- Gastos: panel 1546.875 px frente a 2221 disponibles.
- Checklist de firma REC-2026-0003: 9 envíos/casillas, 0 de 9 comprobados, Firmar deshabilitado; Ver PDF y Quitar del informe presentes. Formulario cerrado sin firmar ni retirar líneas. Ya formaba parte de PR294 y se conserva.

## Rollback preparado

- Gestión: main `5adf2c8a00bf1182b6c9b5c3de095693ece37bd7`, despliegue `dpl_6hZ7KiT1yExDaDtXXFXspukeqySE`.
- Platform: main `40ec644513ac98f91b6931b3607dc7bab8b0df7c`, despliegue `dpl_CyDHGFPkfuRGd8viRVLzU1xPCNu7`.
- Restaurar alias promoviendo el despliegue previo y revertir únicamente el hotfix si procede. No se necesita rollback de base de datos.

## Pendiente de completar tras CI

CI final, SHA de merge, IDs de despliegue READY, geometría posterior en producción y hora de aviso al propietario.

## Comparación de consumo programada (otro hilo)

La automatización original `6ad9d539921881918816717f6a519e1e` terminó a las 09:42:14 UTC; ejecución `07821297-92f0-8333-b4c1-11f76a4d86d6`, conversación `6ad99e94-7200-83eb-b37f-64c319fe713c`. Captura de estadísticas 09:26:33 UTC, reset confirmado 22/10 09:19:20 UTC (24h7min). Según su informe: CPU útil media 6.04%, memoria media 44.11% (máximo 68.90%), cola y fallos cero. El dimensionamiento 10/50/200 se presenta como escenarios de lecturas, sin certificar un compute exacto por evidencia insuficiente de carga. Este recibo registra el resultado de la tarea; no vuelve a resetear ni recalcular estadísticas.

## Fusión autorizada

Gestión: PR296, merge `d3ddb4af4443f6c8f7a395181bf3b1e755b0379e`, 6/6 workflows del head final en verde. Platform: PR83, merge `f2c7a30a7cc3c78d6f674d82493b31f8ded6db84`, workflow completo en verde. Vercel previews de ambas ramas completadas correctamente antes de fusionar. No se ha ejecutado rollback.

## Producción verificada

- gestion: `dpl_FVvd4pni3VPBWfrdH2MuomuW6wW5`, READY, commit `d3ddb4af4443f6c8f7a395181bf3b1e755b0379e`, 2026-10-23T09:50:51.852Z.
- platform: `dpl_8QNN7ERpGUSwJncHWaGNvNMB5YeL`, READY, commit `f2c7a30a7cc3c78d6f674d82493b31f8ded6db84`, 2026-10-23T09:50:36.136Z.

A 2560, Facturación y Gastos ocupan exactamente 2221 de 2221 px disponibles (panel exterior e interior). Soporte: buscador compartido, icono dentro, cero filtros sueltos y sin doble tarjeta. Informes a 390: inset17px, badge ámbar, las tres acciones dentro del viewport y cero overflow. Abrir Enviar por correo carga el formulario y copia al propietario marcada; Enviar PDF permanece deshabilitado sin destinatario. Sin enviar correo. Platform Tickets a390: buscador compartido/icono dentro, cero filtros sueltos, cero overflow. Se restauró el tamaño del navegador.

Se avisó al propietario de la publicación tras confirmar los dos despliegues READY y las cuatro pantallas de Gestión. Recibos completos de CI/producción/mediciones en el JSON adyacente. No se necesitó rollback. Siguiente bloque: logística interna y lista verificable con parada antes de publicación; después reconciliación automática.

CI posterior al merge: Build ZENVIA Gestión y Build ZENVIA Platform sobre sus commits de main completados con success. Por tanto, tanto las ramas revisadas como los merges publicados están en verde.
