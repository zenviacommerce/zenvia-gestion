# Evidencia de verificación — fase 1

Sin ejecución de SQL mutante en producción. Código probado con datos sintéticos y estructura obtenida por catálogo; ninguna factura real emitida.

- Revisión independiente: dos Important reproducidos y corregidos con RED→GREEN (totales de cabecera manipulables; R1 en factura standard sin original). Revisión de correcciones sin Critical/Important abiertos. Core 21/21 revisados independientemente; ampliado después para impedir escritura directa service_role del contador de recibos.
- Cuatro suites fiscales/lifecycle: 96/96 GREEN antes del último endurecimiento de contador; resultado final actualizado a continuación.
- Build local: `npm run build` GREEN; aviso preexistente de tamaño del bundle, sin errores TypeScript.
- Diseño/fixtures: 16/16 en seis suites de primitivas, tabs, settings y representación de logo/PDF legacy, sin cambiar generadores PDF.
- PostgreSQL 17 real, workflow [40079614657](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/40079614657), commit 6cff8af65aa3e5b054c4628db9975f0f6db22aa1: gate GREEN. 20 clientes simultáneos → números consecutivos, SHA-256 y cadena sin bifurcación; 20 reintentos simultáneos → una emisión; dos series → una cadena; rollback → no consume número/registro; ambos órdenes de carrera edición/emisión coherentes; tenant/MFA/archivo privado/emisión directa rechazados. Los ERROR de PostgreSQL de intentos prohibidos son aserciones negativas esperadas.
- Capturas before/after: componentes reales, mocks sintéticos, ninguna conexión de backend; HTML con procedencia explícita y CSS compartido en esta carpeta. Workflow reproduce PNG desktop/móvil con Playwright fijado 1.58.2 y red externa bloqueada.

La suite global inicial encontró solo archivos locales faltantes en el checkout reconstruido, no cambios del producto. Se restauraron exactamente desde main los fixtures binarios, vendor JS, docs y snapshots ya existentes, sin incluirlos como cambios de la PR. La repetición de los seis suites afectados se registra abajo; no se ocultan fallos ni se presentan como regresiones corregidas por código fiscal.

Rollback probado: restaura función guard y reservas del borrador antes de activación; rechaza destrucción del esquema tras actividad. No se afirma igualdad byte a byte de ACL/manifests/timestamps: updated_at del borrador puede avanzar con migración/reversión. Después de uso, solo kill switch y conservación.

## Cierre de pruebas

- Commit de implementación `0ae6b59fda2a6a141008d37e8f6ce447b632f5a4`: CI [40080184557](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/40080184557) GREEN: **144 archivos / 964 tests Vitest correctos**, 1 harness visual opt-in omitido deliberadamente; build GREEN; 16 capturas PNG adjuntas, sin cambios de layout/PDF. Los logs de errores HTTP/MFA simulados son casos negativos de resiliencia, no solicitudes reales.
- PostgreSQL real adicional GREEN: 20 anulaciones concurrentes con una emisión y 20 reintentos de anulación conservan cadena, hora ordenada e idempotencia; 20 justificantes independientes simultáneos numeran sin duplicados/huecos y guardan snapshots, sin crear RF fiscales inferidos. Se calcula el timestamp después de obtener el lock de la cadena.
- Core final **23 casos**, hash TS25 + paridad SQL38 + UI12 = **98 casos específicos** incluidos en la suite completa. Incluye año 2027/serie incorrecta y bloqueo directo de contador para service_role.
- Scripts Node completos locales **1292/1292 correctos** después de restaurar archivos exactos de main y actualizar los contratos que exigían antiguamente editar números/reabrir emitidas. Los nuevos contratos preservan configuración de pagos, cálculo de vencimientos e importación, y exigen número en emisión/referencia externa separada. Cinco contratos compartidos de tabs/búsquedas y diseño pasan; `check-design-contract.mjs` y TypeScript también.
- Revisión independiente final de contador, timestamp y contratos actualizados: sin Important abiertos. El commit final añade la misma batería Node al gate de rama antes de abrir la PR.

`preflight-and-fingerprints.sql` entrega el recuento y huellas reproducibles de contenido cerrado, antes/después, sin exponer datos fiscales. La huella de comparación MD5 es operativa de conservación, no la huella fiscal SHA-256. Archivo SQL de migración SHA-256: `caa58acba4a400a20de33244173d8ac90e2bcb3b8052940ef8262e89dddac81b`; rollback: `68bc11115958ef506555e61157ccb442e170f59559d18aa99ea67870857570c7`.

- SQL operativo adicional probado antes/después de migración: preflight read-only. Activación/kill switch probados en fixture desechable sustituyendo únicamente el UUID del owner: shadow→disabled, dos eventos, cero emisiones.
- Catálogo de producción consultado solo en lectura: authenticated y service_role tienen USAGE sobre private y authenticated puede ejecutar pg_get_userbyid. Las guardas invoker no dependen de un privilegio de esquema inexistente; no se concedió ningún permiso nuevo en producción.

## Ajuste final detectado al revisar capturas

Un nuevo recibo draft todavía se contaba como pendiente de cobro. RED observado con 75 € en borrador y contador pendiente 1; corrección limita los cuatro KPI a recibos emitidos. GREEN UI **13/13**, 99 casos fiscales específicos en total; contratos afectados y TypeScript correctos. Capturas sintéticas regeneradas desde componentes reales: dos filas (una emitida y una draft) conservan la lista, con KPI de pendiente 100 € / 1 recibo, en vez de 200 € / 2. La última CI repite suite completa, contratos, PG y PNG para este estado final.

## Revisión solicitada por el propietario, 24/10 por la tarde

MFA real de PR reveló regresión de metadatos: tres wrappers con retorno compuesto tenían hash calculado con search_path visible public; checker vacío devuelve tipo calificado public.*. Se reprodujo RED con los mismos tres findings; SET LOCAL search_path='' antes del wrapper loop lo corrige, sin aflojar guardas ni cambiar piloto. Core24 +paridad38 GREEN62. [MFA real job 120956135557](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/40122248780/job/120956135557) GREEN11/11, cero skips. Nueva huella de migración: `7e4cdc4afa9a8e6537214be5054d0c098859e12e47df9f59ae1e40ed1d685bc9`.

Resumen operativo, inventario literal de sentencias existentes e histórico de dos renumeraciones acreditadas: `REVIEW-SUMMARY.md`, `existing-table-statements.sql`, `review-production-evidence.json`. Todas las consultas de producción en esta revisión fueron SELECT; no se aplicó la migración.


## Ampliación del circuito, decisión del propietario y cierre local (24/10/2026)

Paquete vigente: [corrección desde pantalla](../20261024-verifactu-correction/README.md). Legado F202650/F202654 y demás emitidas: sin acción ni regularización automática, por decisión expresa del propietario. No se ha aplicado ni publicado fase1/ampliación en producción.

Se añaden clasificación R1–R5/S-I, motivo, edición de líneas en borrador, emisión R transaccional, vínculos y estados derivados, anulación registrada con confirmación y PDF con original. S final−original en los agregados, sin reescribir pagos/documentos. Guardado rectificativo atómico para cerrar la carrera con emisión. La captura disabled bloquea nuevas altas pero conserva la posibilidad de encadenar anulaciones de altas ya capturadas. Lectura de estado mantiene permisos sales OR dashboard; escrituras sales+MFA.

Revisión independiente y correcciones: [informe](../20261024-verifactu-correction/independent-review-and-fixes.md). Local: 1029 Vitest PASS /2 harness visuales opt-in (ejecutados expresamente), 1292 contratos Node PASS, build PASS; 40 capturas reales de componentes con datos sintéticos, 0 desbordamiento horizontal. PDF simple y prueba de 1.000 caracteres/80 conceptos renderizados. Cadenas/numeración/concurrencia real y MFA real deben quedar en verde en CI del head.

El rollback inicial añade search_path=public para restaurar tipos compuestos históricos desde sesiones con search_path vacío. El preflight ignora las siete columnas técnicas nuevas al calcular la huella fiscal histórica; no altera las filas. Hashes actuales de migraciones/rollback/interruptor: [sha256.json](../20261024-verifactu-correction/sha256.json), que sustituye los hashes de rollback anteriores.


CI de `af5b862`: el gate PostgreSQL original pasó todas sus aserciones; el nuevo gate se detuvo en la creación repetida de roles de cluster dentro del fixture, antes de ejecutar la ampliación. Fix de preparación desechable con reproducción RED→GREEN; no modifica migración, MFA ni SQL de producción. Ver [evidencia](../20261024-verifactu-correction/independent-review-and-fixes.md). Reejecución completa del head corregido requerida.

La corrección de los harnesses también mantiene real el helper fiscal puro del capturador Pedidos/Resumen y sincroniza act en el test de historial antes de la interacción. No cambia App/Pedidos. Suite local tras fixture: 1029 PASS/2 visuales opt-in; contratos 1292 PASS; captura Resumen móvil sin fallos; MFA real de af5b862: 11/11 PASS (job120973428106/run40127992552). CI del head posterior debe revalidar todo.

Refuerzo final del rollback: locks sobre16tablas antes del gate, para preservar el primer evento ante emisión/activación concurrentes. PGlite63/63 core+corrección, cuatro carreras reales incorporadas al gate. Actualizados hashes y plan; sin SQL/producción. Revisión final de CI del head requerida.

Cierre local: 1031 Vitest PASS /2 harness visuales opt-in ejecutados expresamente; 1292 contratos Node PASS. SQL63/63 core+corrección y hashes de rollback coinciden. Paso pendiente final: CI del SHA que incluye los locks de conservación y capturadores financieros sin stub del helper puro. No hay cambios ni consultas nuevas en producción en esta ampliación.
