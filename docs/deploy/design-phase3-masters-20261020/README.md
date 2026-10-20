# Fase 3 · lote 1: Productos, Clientes y Proveedores

Para revisión del propietario. **NO PUBLICADO.** Componentes reales y CSS de la app; 32 registros sintéticos por pantalla; red bloqueada; locale es-ES; viewport 1000 px de alto. Referencia antes: main ed63ce7a, fase 2 validada.

| Pantalla | Ancho | Antes | Después |
|---|---:|---|---|
| Productos | 390 | ![Antes](before-products-390.png) | ![Después](after-products-390.png) |
| Productos | 1280 | ![Antes](before-products-1280.png) | ![Después](after-products-1280.png) |
| Productos | 1440 | ![Antes](before-products-1440.png) | ![Después](after-products-1440.png) |
| Clientes | 390 | ![Antes](before-clients-390.png) | ![Después](after-clients-390.png) |
| Clientes | 1280 | ![Antes](before-clients-1280.png) | ![Después](after-clients-1280.png) |
| Clientes | 1440 | ![Antes](before-clients-1440.png) | ![Después](after-clients-1440.png) |
| Proveedores | 390 | ![Antes](before-suppliers-390.png) | ![Después](after-suppliers-390.png) |
| Proveedores | 1280 | ![Antes](before-suppliers-1280.png) | ![Después](after-suppliers-1280.png) |
| Proveedores | 1440 | ![Antes](before-suppliers-1440.png) | ![Después](after-suppliers-1440.png) |

## Altura absoluta hasta el primer dato

| Pantalla | Ancho | Antes (px) | Después (px) | Pantallazos después |
|---|---:|---:|---:|---:|
| products | 390 | 1855.1 | 1148.5 | 1.15 |
| products | 1280 | 918.4 | 907.2 | 0.91 |
| products | 1440 | 932.4 | 907.2 | 0.91 |
| clients | 390 | 1590.2 | 1057.7 | 1.06 |
| clients | 1280 | 834.5 | 879.3 | 0.88 |
| clients | 1440 | 725.5 | 879.3 | 0.88 |
| suppliers | 390 | 1475.2 | 1044.7 | 1.04 |
| suppliers | 1280 | 741.5 | 762.9 | 0.76 |
| suppliers | 1440 | 711.5 | 762.9 | 0.76 |

Selección antes: se vaciaba al buscar en las tres pantallas. Después: persiste por ID al buscar/ordenar/paginar y se revisa/quita también fuera del filtro. Las confirmaciones enumeran toda la selección, incluso la oculta; el harness cancela las eliminaciones y bloquea cualquier escritura. Columnas de selección e identidad fijas, acciones React sin simulación de clics del DOM. No se cambia la carga completa ni se afirma paginación en servidor en este lote. Se conservan las cifras y variantes semánticas anteriores (ningún aviso nuevo inferido por el nombre de la métrica).

Capturas móviles adicionales: `before/after-<pantalla>-390-second.png` y `after-<pantalla>-390-dark.png`.
