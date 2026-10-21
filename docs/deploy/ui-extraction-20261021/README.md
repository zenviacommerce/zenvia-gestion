# @zenvia/ui 0.1.0 — extracción para revisión

Base: Gestión main 45441a470dd2ff30fc4d78020a0cc1309290bf6d (hotfix de facturación #270 y ordenación #271 publicados por separado). Este paso prepara un paquete compartido y su adopción compatible en Gestión. **No publicar ni fusionar hasta revisión del propietario. Platform lote B todavía no se modifica.**

## Cambios y límites

- Una fuente de PageHeader, KpiGrid, StatCard, FilterBar, PageTabs, DataTable/MobileList, FormModal/FormSection/FormGrid y ordenación reversible. Los paths antiguos de Gestión reexportan el paquete.
- JS/CSS extraídos de producción sin cambios de comportamiento. Manifiesto SHA-256 de fuentes aprobadas; se mantiene el import de forms en su adaptador para conservar la cascada.
- ESM, declaraciones TypeScript y CSS exportado. Versión exacta 0.1.0, React 19.2.1 y lucide-react 0.468.0 externos. No contiene servicios, Auth, red ni datos.
- La capa de diseño comparte tokens/reglas aprobados y formularios; el host conserva su tema base (tipografía, .card/.stat, botones y estilos especializados). Este paso no introduce un reset visual global. Al adoptar en Platform se ajustará su base a ese contrato, con sus propias capturas.
- Build automático del paquete al instalar/construir/probar Gestión. No se distribuye código fuente copiado en Platform.

## Versión y despliegues independientes

Gestión usa un workspace con dependencia exacta @zenvia/ui=0.1.0 y su lockfile. Publicar un artefacto no despliega ni actualiza aplicaciones.

Distribución preparada como tarball npm inmutable en GitHub Releases, con hash, etiqueta ui-v0.1.0 y workflow **manual** que crea un borrador. No se ha creado etiqueta, release ni publicado paquete. private:true impide publicar accidentalmente en un registro público. Evita asumir un scope GitHub Packages @zenvia bajo el propietario zenviacommerce, que no coincide.

Platform podrá descargar/verificar el artefacto aprobado, guardar vendor/zenvia-ui-0.1.0.tgz y fijarlo con integridad en su lockfile. Instala el mismo nombre/versión, sin duplicar la fuente ni necesitar credenciales de registro durante cada build. Cada actualización exige una versión/artefacto nuevos y un cambio explícito del consumidor.

## Verificación

- Paquete: API, versión exacta, peers, ausencia de servicios/React empaquetado, hashes de código/CSS de producción.
- Consumidor aislado del tarball: render de cabecera, variante dorada, grid, formulario y reset de orden; compilación de tipos, incluidos tabs genéricos.
- Gestión: suite React completa y Node/SQL; contratos de diseño siguen auditando también packages/ui/src. Pruebas antiguas que inspeccionaban archivos leen ahora al propietario real; no se elimina ninguna comprobación.
- Harness: la comparación independiente carga el código anterior desde el commit base y el actual desde el paquete, con fixtures sintéticos, red bloqueada, locale es-ES, fecha fija y animaciones/cursor desactivados únicamente en capturas. Compara bytes PNG completos (más estricto que comparar solo píxeles), sin tolerancia ni máscaras.
- Capturas: 17 vistas, 390/1280/1440 y segundos pantallazos móviles. [Comparación automática](review/comparison.json), [antes](review/before/), [después](review/after/). Los manifiestos por lote incluyen altura hasta el primer elemento.

## Inventario

Resumen, Pedidos; Facturación, Gastos, Recibos; Productos, Clientes, Proveedores; Amazon Resumen/Productos, Shopify Resumen/Productos; Soporte, Configuración, Administración, Auditoría y Gmail.

## Rollback

Antes de publicar: cerrar esta PR y conservar main 45441a47. Después de una eventual aprobación/publicación: revertir solo esta extracción o promover el despliegue de ordenación dpl_CB76xZWQJmZppTwhoBE6LY8cYKVe / bundle index-DMphM7HP.js. No hay migraciones, flags de producción, Auth/Edge ni cambios de datos. Revocar/retirar un borrador no cambia aplicaciones. Las versiones consumidas por Platform se actualizarán por separado.

## Desviaciones de verificación

El harness anterior asumía archivos propietarios locales; ahora resuelve los exports CSS del paquete como Vite, manteniendo el mismo orden. Una prueba VM de Gmail apuntaba al adaptador: se actualizó para leer el componente real. La captura de extracción desactiva animaciones y transiciones CSS antes del primer pantallazo, espera las fuentes y espera 2,2 segundos cuando existe una gráfica Recharts (su animación SVG por JavaScript termina a los 1,9 segundos). El producto conserva sus animaciones. El navegador del harness usa `--disable-gpu` y `--disable-skia-runtime-opts` para evitar variaciones de rasterizado; no se aplica tolerancia ni máscara. No se cambia el producto para igualar imágenes.


## Reanudación y comprobaciones del 21 de octubre

- Recuperado checkout original en rama local `refactor/shared-ui-0.1.0`, sin commit/PR previo; remoto main confirmado en `45441a470dd2ff30fc4d78020a0cc1309290bf6d`.
- Build completo de Gestión ejecutado de nuevo. CSS resultante `index-KrPt1wkg.css`: SHA-256 `6992810b25f970a5564de76beb863640afa35602a0133d9ca0c7e7d897110548`, idéntico al build conservado del hotfix #271. No cambio del orden CSS compilado.
- Vitest completo: **271/271** en 52 archivos con `npm test -- --maxWorkers=2`. Primera ejecución simultánea a build/Node tuvo timeout en `pickup-reports-sql.test.ts`; ejecución con concurrencia acotada pasa sin aumentar timeouts.
- Node/SQL: **1.243/1.243**, usando exactamente la selección CI que excluye `mfa-real-integration.test.mjs`. El primer glob sin exclusión falló en esa prueba porque requiere su entorno local GoTrue/Vault y `RUN_LOCAL_AUTH_VAULT_TESTS=1`; no se ha configurado ni ejecutado contra producción.
- Contrato específico del paquete: **3/3**, incluido render y compilación TypeScript de un consumidor aislado del tarball. Contrato de diseño pasa. `esbuild@0.25.12` declarado directamente como herramienta de build.
- Revisión visual estricta al reanudar: 60/66 PNG idénticos; 6 diferencias, incluyendo una gráfica SVG a mitad de animación y variaciones de rasterizado. Se conserva ese diagnóstico; la repetición final usa el harness estabilizado. El resultado final se registra en `review/comparison.json` y el recibo de revisión.
- Revisión independiente de código y de instalación limpia solicitada; resultado en recibo final.

## Corrección manual comunicada por el propietario

El propietario informa que el pedido **407-0024766-5208363** se pasó manualmente a **MRW / Sendcloud**, seguimiento **01009F045746**. Se registra aquí por continuidad del diario. Esta tarea no ha realizado ni repetido esa modificación ni la ha verificado en base de datos.

## Punto de parada

Revisión del propietario antes de merge, tag, release, publicación del paquete o despliegue de la extracción. El lote B de Platform queda para el siguiente paso, una vez revisada esta comparación. MFA no se modifica; no se emiten facturas ni documentos reales.


## Recibo final local — extracción lista para revisión

**66 de 66 PNG son idénticos byte a byte** en la comparación estricta final; cero píxeles distintos, sin máscaras ni tolerancias. [Tabla completa antes/después](review/README.md) y [recibo verificable](verification.json).

La investigación separó el ruido del navegador de los cambios del paquete: el control baseline/baseline también produjo bordes diferentes, mientras que geometría y SVG coincidían. Congelar CSS antes del montaje de React y usar rasterización por software eliminó las diferencias. Ninguna fuente de producto se modificó para lograr la igualdad. La gráfica se captura una vez terminada su animación JavaScript.

Revisor independiente: sin bloqueadores; comprobó fuentes y CSS contra git, tarball SSR/TypeScript y `npm ci --offline` en una copia temporal sin dist ni node_modules. Los iconos generados por el build, logs, builds y capturas históricas quedan fuera del cambio.

Estado: preparada para PR en borrador y CI. La publicación continúa detenida para revisión del propietario. El estado de CI no se deduce del resultado local; se consulta en la PR.


## Primera CI de la PR #272

Commit `718c9bfb`: build, Auth/Vitest, Node/SQL, Vercel y el workflow nuevo de paridad visual estricta pasan. El workflow visual general falla en `Full filter option labels changed`: el harness de maestros consultaba `getByRole('option')` antes de que el portal fuera visible (su visibilidad cambia en requestAnimationFrame). Los logs muestran listas vacías intermitentes tanto en baseline como en current; la selección se conserva.

Corrección limitada al harness: esperar el listbox identificado por aria-controls y sus opciones visibles; leer sólo ese listado; cerrar desde el combobox y esperar que desaparezca. No se relajan aserciones ni se cambia el producto. Se repite el flujo completo de maestros antes/después y la CI. La comparación de 66 PNG ya fue validada por GitHub Actions en el primer commit.

Verificación del follow-up: flujo real del harness de maestros completo, 9 vistas/anchos antes y 9 después, todas sin fallos; etiquetas completas de todos los filtros y selección conservada en current. [Recibo de opciones y selección](masters-ci-followup.json). Revisor independiente confirma la corrección de sincronización sin cambiar el producto ni relajar aserciones.
