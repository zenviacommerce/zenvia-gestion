# SDD ledger — plan: docs/deploy/20261024-verifactu-phase1/implementation-plan.md
Base remota main dadf8262c35dcc64f928675ebb4de122141bb788. Copia aislada feature/verifactu-shadow-phase1-20261024, baseline local reconstruida; no equivalencia de SHA local a GitHub.
Pre-flight: emisión→numeración→snapshot/cadena es una transacción; cadena/config deben bloquearse antes de asignar número. Receipts independientes generan evento de documento, nunca RF fiscal inferido por su total.
Ruling: usar helpers SECURITY DEFINER con validación tenant/permiso/MFA y guardas invoker que comprueban propietario interno para transiciones; ninguna GUC editable habilita mutabilidad. Administrador DB sigue siendo límite de confianza documentado.
Ruling: garantías correlativas desde el corte, inicialización a high-water existente; no reconstruir pasado ni reutilizar números de documentos borrados.
Task 1: auditoría 23 rutas iniciales y snapshot de20funciones/105columnas; UI tests RED8→GREEN8 enagente, enintegración.
Task 3: hash puro TS25tests y3vectoresoficiales GREEN enagente; pendienteparidadSQL.
Task 1 DONE: rutas cliente y 21 funciones reales +49bundlesEdge +triggers/FK/grants; cierres comunes BD, UI draft-only. #304 aceptación propietario archivada sin cambios adicionales.
Task 2 DONE: asignador transaccional porserie/año, ancla highwater, orden cadena→serie y parent lock; PG17 real20clientes/20retries/dosseries/rollback/carreras GREEN.
Task 3 DONE:3vectoresoficiales TS25+SQLparidad38; append-only RF/eventos y snapshots; rectificación explícita. Sin XML/PDF/AEAT en estafase.
Task 4 DONE: disabled inicial, activaciónowner1SQLrevisable/kill switch y corte documentados, no backfill deemitidas.1draftreservationprivatelybacked;28closed+8receipts contentpreserved.
Task 5 REVIEWED: revisión independiente dosImportant corregidos con testRED→GREEN; sinCritical/Important abiertos. Core21GREEN; contadorservice_role endurecido con otro testRED antesfix. Rollback2casosGREEN. BuildGREEN. Pendientecapturas/últimoCI y PRborrador; DETENERalcrearPR. ProducciónNOaplicada.
Cierre: Core23+TS25+SQL38+UI12=98; CIglobalVitest144files/964testsGREEN+1harnessopt-inomitido; Node1292GREEN; build+tsc+contratosGREEN; PG20anulaciones/20retries/20recibossimultáneosGREEN. RevisorúltimoscambiossinImportant. FaltaúltimoCIcontratos+abrirPRdraftySTOP. Preflightfingerprints/SQLsha/kill switch yrollbackincluidos. Noaplicaciónproducción.
VisualQA encontródraftrecibo incluidoKPI: testREDcon75€/1pendiente→GREENcon0€/0; UI13total99específicos, capturasregeneradas. ÚltimaCIparaestadofinalyPRSTOP.
