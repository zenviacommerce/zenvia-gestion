# Pestañas compartidas — A

Estado: implementación local; publicación pendiente de revisión del propietario.

Estimación inicial: 4–7 h. Diseño indicado por el propietario: tarjetas de superficie, activa unida al panel, marca y peso destacado, badges neutros y peligro para incidencias positivas. Una sola implementación en @zenvia/ui.

## Inventario y decisiones

Gestión: Pedidos (6), Amazon (6), Shopify (3), Facturación (2), Facturas de gasto/Gmail (2), Configuración (secciones según permisos), Soporte administrador (2), Administración (2). Platform: detalle de cliente (6 y Demo cuando procede). Navegación principal y filtros no son pestañas.

Todas las pestañas serán horizontales y desplazables, también Configuración en escritorio. Esto permite el mismo tratamiento de tarjeta unida al contenido en ambas aplicaciones. Se conservan etiquetas, descripciones, iconos, contadores, permisos, handlers, formularios retenidos y guardia de cambios sin guardar.

## Verificación prevista

- Tests de ARIA, teclado, foco, cancelación asíncrona, visibilidad de la activa y badges semánticos.
- Contrato de exclusividad que detecta roles/aria de pestaña y clases de implementaciones propias fuera del paquete; fixtures positivos y negativos.
- Capturas de las 9 pantallas antes/después a 390/1280/1440, claro/oscuro; datos sintéticos y red bloqueada. Inventario de acciones comparado.
- Build y suites de ambos repositorios; mismo paquete empaquetado en Platform. Revisión independiente antes de entregar.

## Rollback preparado

Sin producción modificada. Gestión base publicada: 036c49b78362a67921ffcffea522a4ad81e67a79. Platform: 7552bd7cf0b3c9712a0a706741e93875099dc774. Revertir commits de UI y restaurar paquete/lock previos; no hay migraciones ni datos afectados. Se anotarán los despliegues actuales antes de cualquier publicación autorizada.

2a: recibos, ACL, hashes, versiones Edge y rollback en 20261022-external-shipment.md, guardados en GitHub en 9dea92f41ea6412e95d17c66bf086b5d85cf7b04. PR #288 de 2b aparcada por cambio de prioridad. Después de A se realizará B, con otra parada antes de publicación.

## Evidencia final local

- 575/575 Vitest; 28/28 contratos focalizados (paquete aislado, accesibilidad, CSS, navegación y Shopify). Platform 316/316 Node. Ambos builds correctos. Suite Node general de Gestión: 1284/1284 con concurrencia 2; Auth/Vault real se valida únicamente en CI desechable.
- Galería 54 pares / 108 PNG, tres anchos y dos temas. Comparación de etiquetas, contadores y acciones exacta; hashes en comparison.json. Red bloqueada, App/componentes reales y fixtures sintéticas.
- Revisión independiente: sin pérdidas de acciones/handlers/retención; corregida la unión visual de la pestaña activa y reforzado gate de CSS y tokens genéricos. Foco tras click vetado probado en rojo y verde.
- Paquete @zenvia/ui 0.2.0 SHA256: 13e046836dc5631e38b6097f093417dbfc00512a4aa51a0a57a67fbccfdae6b2. Misma fuente y tarball de Platform; no hay tag ni release publicado.
- Tarea de consumo existente verificada: 6ada0435d7d081918b634b4fe22aa88e, 23/10/2026 11:20 Europe/Madrid. No se crea otra.
- Parada obligatoria antes de publicar A. B en desarrollo, estimación revisada 8–12 h, antes de 2b.

- Regresión adicional Home tras scroll manual: prueba roja y verde; 10/10 pruebas focalizadas de pestañas tras el ajuste. Swipe mediante eventos táctiles nativos de Chromium a 390 px, sin red, con desplazamiento comprobado en manifiesto de Pedidos.

## Ajuste de contrato de CI visual

La revisión financiera histórica buscaba la clase expenseHubNav retirada por la nueva primitiva. Se sustituye por roles tablist/tab, conservando la comparación exacta de etiquetas, descripciones y recuento de roles en la entrega actual. El control de ancho comprueba límites del viewport; el desplazamiento interno es intencionado. Reproducción local del script completo: 9/9 combinaciones Facturación/Gastos/Recibos ×390/1280/1440, sin fallos de contenido, selección, filtros ni acciones. Ver finance-contract-verification.json. No se cambió la UI ni se eliminó ninguna comprobación funcional. CI vuelve a ejecutarse antes de cerrar la revisión.

Segunda revisión de CI: el baseline remoto aa8677d usa botones sin role=tab dentro de expenseHubNav; leído directamente de GitHub. El inventario lee ambos marcados para comparar antes/después, mientras la entrega actual sigue obligada a tener dos roles tab. El primer ajuste local había usado un baseline moderno y no detectó esta diferencia histórica. Sin cambios de UI.

CI posterior confirma superadas Finanzas, listas maestras y Amazon/Shopify; detecta el mismo supuesto histórico en el scroll móvil de Configuración antes de la migración. El selector de ese paso reconoce el nav histórico y el tablist actual. Se mantienen click, rechazo de cambios sin guardar y guardia de teclado en la entrega actual.

CI definitivo de A: las seis comprobaciones de Gestión y la de Platform correctas, con heads y enlaces en 20261022-shared-tabs-ci-receipt.json. A continúa en borrador #289/#82, sin publicación.
