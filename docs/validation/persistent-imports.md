# Importaciones persistentes: validación y despliegue

Fecha: 6 de octubre de 2026. Rama: `feat/persistent-imports`. Base: `d6ad0c0d`.

## Resultado y alcance

Cola persistente, ejecución con Cron y worker interno, originales privados, reintentos, cancelación y revisión recuperable para gastos (archivo, cámara y lote), Gmail, ventas, tarifas, Shopify y Envia. El cierre del modal y la navegación no cancelan una tarea aceptada. Amazon conserva su cola existente y aparece en el historial; el importador directo de Sendcloud sigue desactivado y muestra su resultado omitido.

Backend desplegado **solo en desarrollo** (`yyjknhqkpyxzmuvavpcq`): `import-jobs`, `import-worker`, `shopify-orders`, `envia-shipping`, versión 3. La compilación del frontend queda preparada en esta rama; no se ha publicado el frontend ni modificado producción.

## Evidencia

| Comprobación | Resultado |
| --- | --- |
| Compilación TypeScript/Vite | Correcta; advertencia existente sobre tamaño del bundle |
| Deno: los cuatro endpoints y sus dependencias | Correcto |
| Pruebas específicas de importaciones | 26/26 |
| Servicio Python: lectores, HTTP, autenticación, persistencia y reinicio | 4/4; Ollama simulado |
| SQL transaccional en desarrollo | 6 archivos correctos; fixtures revertidos |
| Interfaz React en DOM: cerrar modal, recuperar revisión al remontar y confirmar versión | Correcta; respuesta de API simulada |
| Suite completa | 784/809; 25 fallos que ya existían en la base, ninguno nuevo |
| Suite de la base | 761/787; 26 fallos |
| Cron real sin consulta desde el navegador | Una factura sintética creada y tarea completada |

Prueba real de Cron: tarea `22a7788f-2cff-44a9-b9b1-2c54c9cf67a6`, completada a `2026-10-06 17:19:01.688574 UTC`, importadas 1, fallidas 0. El item `d7a8470d-c5bc-42f5-841f-e04cbcaf7c54` quedó importado y creó la factura `87cd3ba7-c8e9-41f2-b12d-7764c477c991`. Se usó un candidato preparado para comprobar la cola y el guardado, no OCR real. Los datos y la cuenta sintética se eliminaron después.

Los SQL comprueban idempotencia, recuperación de leases, cancelación, separación de empresas, permisos revocados, reserva de numeración, borradores de ventas, reanálisis de tarifa conservando el ID, política de creación de proveedores y clientes, replay de pedidos y conservación transaccional de etiquetas. La prueba RLS usa el rol `authenticated`: lectura de su empresa, denegación de empresa ajena, escrituras/RPC de worker y caché inaccesibles y bloqueo de empresa suspendida.

## Revisión independiente y correcciones

Una revisión final de contexto limpio encontró tres incidencias importantes y ninguna crítica. Todas se corrigieron con regresiones específicas:

1. Shopify conservaba datos de envío desde una lectura susceptible de quedar antigua. La resolución de conflictos conserva ahora la etiqueta y sus datos desde la fila actual en la transacción. Envia comprueba también el proveedor actual bajo bloqueo antes de actualizar.
2. Un abono con importes positivos podía pasar como gasto ordinario. Se rechaza tanto en el validador como en el RPC de guardado de gastos y ventas; requiere un tratamiento contable específico.
3. Un cliente seleccionado que se desactivaba podía sustituirse por el propuesto en OCR. Se rechaza inmediatamente el ID explícito no disponible, antes de buscar o crear otro.

Los SQL de etiquetas y cliente seleccionado fallaron antes de las correcciones y pasaron después. La regresión de abonos falló antes y pasó después. No se volvió a solicitar otra revisión independiente; se validaron las correcciones de la revisión final.

## Pendiente y límites de la evidencia

Faltan `DOCUMENT_WORKER_URL`, `DOCUMENT_WORKER_SECRET` y el servidor local con el modelo Ollama real. No se ha demostrado la precisión de extracción ni la separación visual de documentos reales. El servicio y sus instrucciones de instalación están en `tools/document-worker/README.md`; `/health` comprueba el modelo, no solo que el proceso responda.

No se ejecutaron llamadas reales de Gmail, Shopify o Envia con cuentas del usuario. Las pruebas de credenciales persistentes, paginación/adaptadores y guardados no equivalen a verificar conectividad y límites de esos proveedores.

La inspección visual en navegador no pudo realizarse: el navegador local automatizado no arrancó y el navegador remoto rechazó la dirección local. La aceptación de interfaz se comprobó con React y DOM automatizado.

Los 25 fallos existentes de la suite completa corresponden a contratos anteriores de pedidos, MRW, Sendcloud, tarifas, controles de configuración y motor de gastos. La comparación de nombres con la ejecución de la base no detectó fallos nuevos. No se presentan como una suite totalmente verde.

El asesor de seguridad mantiene advertencias anteriores (funciones existentes y extensiones); el caché nuevo carece intencionadamente de políticas/privilegios para el navegador. Las funciones de escritura de importaciones están reservadas a `service_role`.

## Decisiones y coste

- Se trabajó en el checkout aislado existente en lugar de crear otro worktree. Coste si hiciera falta más aislamiento: trasladar la rama.
- El servicio local recibe y persiste solicitudes; Supabase consulta el resultado en lugar de esperar la inferencia en una petición. Coste: latencia adicional del sondeo.
- Archivos/cámara de gastos y ventas conservan confirmación manual; Gmail solo da de alta candidatos seguros. Coste: una confirmación por documento.
- Sendcloud directo sigue desactivado y Amazon no se reescribe. Coste: activar/cambiar esas integraciones requeriría trabajo aparte.
- Desarrollo estaba detrás del esquema del repositorio. Se aplicaron también los prerrequisitos existentes de proveedor de tarifas y envío: `20260929143000_multi_shipping_envia.sql`, `20261001104500_direct_mrw_provider.sql`, `20261001111500_label_print_history_known_state.sql`, además del prerrequisito de proveedor de tarifas. Producción no se alteró. Coste: revisar esos prerrequisitos al promover las migraciones.
- Se aceptan las limitaciones operativas de la revisión (modelo real, proveedores reales y publicación), que siguen pendientes; no se interpretan como pruebas superadas.

## Promoción y reversión

Antes de producción: conectar el servicio local con HTTPS accesible desde Supabase, comprobar `/health`, revisar la secuencia completa de migraciones y prerrequisitos, configurar secretos del servidor, desplegar los cuatro endpoints y frontend y verificar un documento real cerrando el navegador tras la aceptación. Comprobar duplicados, revisión recuperada y una cuenta Gmail con refresh token persistente. La conexión y promoción no se han realizado.

Reversión conservadora: detener Cron `import-worker`, detener nuevas altas desde el frontend y restaurar la versión anterior del frontend y endpoints. Conservar cola, originales e historial y todos los registros ya creados. No revertir mediante eliminación de tablas ni borrar documentos de negocio; revisar/cancelar tareas pendientes explícitamente antes de reactivar trabajadores.
