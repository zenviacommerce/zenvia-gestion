# 23/10/2026 · Hotfix visual de pestañas, buscadores e informes

Autorización del propietario: un despliegue del hotfix visual; después, estado logístico y lista verificable en firma con parada antes de publicar.

## Base y rollback antes de publicar

Gestión: main `5adf2c8a00bf1182b6c9b5c3de095693ece37bd7`, Vercel `dpl_6hZ7KiT1yExDaDtXXFXspukeqySE`. Rollback: promover ese despliegue anterior y revertir únicamente el commit del hotfix si es necesario. No hay SQL, Edge Functions, datos, purgas ni cambios en confirmaciones de marketplaces en este bloque.

Platform: main `40ec644513ac98f91b6931b3607dc7bab8b0df7c`. Vercel `dpl_CyDHGFPkfuRGd8viRVLzU1xPCNu7`, READY verificado antes de publicar.

## Evidencia y diagnóstico

- 72 capturas previas de 9 pantallas de Gestión: 390/1440/1920/2560, claro y oscuro.
- Prueba roja de ancho real: Facturación a 2560 ocupa 1733.156 px frente a 2236 disponibles (77.51%). Tabs carecía de width:100% en un padre flex.
- El contrato estático permitía un input nativo dentro de cualquier FilterBar. Se elimina esa exención para búsquedas; migración de búsquedas de listas a SearchField. Los formularios y búsquedas internas de combobox conservan su semántica.
- Soporte adopta SearchFilters, sus filtros Estado/Tipo y chips; sin card anidada.
- Informes usa inset explícito del componente compartido, badges de estado, acciones en una fila adaptable y acceso directo al formulario de correo (nunca envía al abrir).
- Controles analíticos de periodo y FilterBar estructurados existentes conservan sus acciones; el test geométrico de Soporte e Informes exige filtros cerrados sin selects sueltos.

## Inventario de acciones

Pedidos: Nuevo pedido, Actualizar y Más acciones conservados. Soporte: Nuevo ticket, Actualizar, búsqueda, Estado, Tipo, limpiar/quitar filtros y abrir ticket conservados. Informes: búsqueda, Estado, Transportista, chips, reimpresión y Abrir informe conservados; se añade acceso directo a Enviar por correo. Cerrar historial y crear sustituto tras anulación conservados. No se retira ninguna acción.

## Pendiente

Capturas posteriores, pruebas de geometría y acciones, revisión, CI y recibos de publicación.

## Verificación local

685/685 Vitest (122 archivos), 1291/1291 Node con el mismo alcance del workflow build (la integración Auth/Vault requiere su Supabase local y se ejecuta en su workflow dedicado), build correcto. Prueba Gmail de selección/importación ajustada para inyectar el SearchField real en su harness VM. Contratos y consumidor aislado del paquete 0.2.1 correctos. Revisión independiente: sin bloqueantes funcionales en los componentes; helper de prueba de Platform corregido. La lista verificable de firma publicada en PR294 se conserva.

Tarea de consumo: detectadas dos automatizaciones equivalentes. Se mantiene la original `6ad9d539921881918816717f6a519e1e` (11:19:53 Madrid, contexto detallado de métricas) y se pausa la duplicada `6ada0435d7d081918b634b4fe22aa88e`. No se resetean estadísticas.

Capturas y geometría final: 72 pares antes/después en Gestión, incluidas las 9 pantallas con pestañas a 390/1440/1920/2560 claro/oscuro. Panel exterior e interior al ancho útil del padre; icono, padding, filtros cerrados y acciones de informes comprobados. Inventario de pestañas y acciones de cabecera idéntico. Platform: 24 pares y las mismas comprobaciones de ancho/búsqueda. No se ha publicado todavía.

## CI: inventario de búsqueda accesible

El primer pase remoto falló en la comparación histórica de controles de Facturación: SearchField convierte el input text sin nombre accesible en type=search con aria-label derivado de su mismo placeholder. No faltaba ninguna acción. El inventario normaliza exclusivamente esa transición aprobada de búsqueda, conservando número de controles, textos, nombres explícitos, fechas y estados disabled. Prueba roja/verde cubre pérdida de control, cambio de nombre, cambio de disabled y cambio indebido de tipo. Se repite el flujo visual completo; no se omite ningún check.
