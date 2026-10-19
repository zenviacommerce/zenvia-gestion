# Cierre del bloque de rendimiento — 19 de octubre de 2026

Horas de negocio: Europe/Madrid; los recibos técnicos conservan UTC. Este informe consolida cambios autorizados, incidencias, resultados medidos y límites. No presenta proyecciones como medidas de 24 horas.

## Incidentes y causa

1. **Saturación de la base de datos.** El compute NANO llegó a CPU/memoria al 100 %, con errores de pool PGRST003 y cancelaciones 57014. Se amplió a SMALL a las 12:28 de Madrid, según el cambio confirmado por el propietario. La ampliación resolvió el límite de capacidad; se redujo además la carga evitable para no depender solo del hardware.
2. **Arranque bloqueado por MFA.** security_mfa_status devolvía 503 o no respondía durante la saturación, y el frontend MFA impedía entrar. Se sirvió temporalmente el bundle pre-MFA index-BkauntMi.js. Después se publicó el arranque fail-open cuando MFA está desactivado, con pruebas de RPC503 y llamada que nunca resuelve, manteniendo restricciones explícitas ya conocidas. No se activó el piloto ni se retiraron factores.
3. **Transportistas con 409 y opciones inconsistentes.** Cotizaciones concurrentes usaban withAmazonBuyerRead, que adquiría el lease exclusivo amazon_pii_claim_external_read de 480 s por pedido: se bloqueaban entre proveedores con409; finally intentaba liberarlo y una interrupción lo dejaba hastaTTL. Se retiró la exclusividad de las cotizaciones y se mantuvo el control de acceso de lectura. Por separado se amplió el lease exclusivo de creación de etiqueta de 300 a 480 s, con liberación en finally/TTL de recuperación. El lease480s protege una creación larga, no debe bloquear cotizaciones. Prueba dos cotizaciones200/200 y dos creaciones simuladas200/409, sin comprar etiquetas. El modal muestra cada proveedor, progreso, errores y reintento; un contrato directo excluye ese transportista en todos los agregadores del workspace. MRW directo sin cobertura conserva estado visible, sin sustituto agregado. Los rechazos de ruta Envia se muestran como no aplicables, no como errores reintentables.
4. **Paridad de costes tras paginar.** #237 omitió estimaciones por tarifa al pasar el KPI al servidor; la comparación inicial no incluyó costes, neto ni ticket medio. #244 recuperó la valoración mixta en todo el filtro, con proyección mínima y sin cotizar proveedores. La verificación inicial del reparto no sobrevivió al sync siguiente: Amazon seguía declarando MRW en un envío cancelado allí y reemplazado por Correos Express. El propietario confirmó la historia. #245 protege transportista, tracking, coste y etiqueta del envío real local y conserva marketplace_carrier aparte frente al dato obsoleto de marketplace; no se fuerza ningún desglose. Pedido402-4191875-5589160, coste real4,57€ viaEnvia/epaq_24. Se conserva la trazabilidad y el respaldo del registro.

## Cambios y métricas

| Área | Antes | Después / evidencia |
|---|---|---|
| Compute | NANO saturado | SMALL; max_connections=90. Estado Supabase ACTIVE_HEALTHY en comprobación final. No equivale a afirmar CPU exacta actual sin telemetría |
| Claim/count Amazon | 274 ms | 14 ms en la medición aceptada; índice y consulta agrupada de amazon-status |
| Escrituras Amazon | 259 UPDATE para 448 lecturas operativas en ventana basal | 3 UPDATE/222 lecturas: −97,66 % normalizado. Ciclo natural 6/474: −97,81 %. Sin cambios: 0 UPDATE; cambio de negocio: 1 UPDATE; last_synced_at conservado sin escrituras de refresco vacías |
| Jobs pedidos | 2.745 creados/24 h;117/h por9marketplaces y productor horario duplicado | Un job por cuenta/región cada 5 min:12/h medidos de 13:30–14:30UTC (12/12success,0failed,media4.577,33ms); proyección288/día; cero pedidos perdidos |
| Cobertura agrupada | Referencia208 pedidos en9marketplaces | Referencia independiente210 a13:28UTC, todos importados:130 del día anterior y80 de hoy. Incluye pedido nuevo Francia; IE sin pedidos en ventana. Dos invocaciones completas del worker verificadas |
| Retención | 500/día frente a3.177 jobs creados/24 h (3.168 terminados en otra lectura) | 18 ejecuciones nocturnas×500=9.000/día,2,83×generación basal;14 días, kill switch y recibos |
| Limpieza supervisada | 10.280 antiguos pendientes tras primera limpieza | 21 lotes,31–116ms, media53ms;0failed. Total diario12.780 borrados contando2.500 de la primera fase;26 lotes positivos,media59,12ms en recibos a14:44UTC |
| Pedidos paginados | Lista completa y cálculos de cliente | Página 25, KPIs de todo el filtro, RPC deIDs con límite 2.000 y aviso sin truncamiento; selección global63/25 probada sin crear etiquetas |
| RPC de dashboard | Primera implementación8.859 ms por expansión repetida del registro compuesto | 216→3 evaluaciones para3 filas;700,602 ms tras corrección;778,004 ms con candidatos de tarifa en comprobación real posterior |
| KPIs trimestre verificados por usuario | Regresión224,56 €, 51/58 | Total254,73 €, 58/58;neto2.896,73 €;ticket26,98 €. Desglose MRW 190,00 € / Correos 64,73 €, sin diferencias en cinco periodos tras worker; detalle en recibo #245 |

La lectura24 h de generación anterior fue orders2745/finances216/inventory216 (total3177); reintentos reutilizan filas y no explicaban el exceso. Finances/inventory siguen por marketplace cada hora. La retención sobrante aporta margen adicional después de agrupar pedidos.

## Estado de producción

- Supabase sjkxxbedkkmgmqnvaqjh: Pro/SMALL según cambio confirmado; PostgreSQL17;90 conexiones; proyecto saludable. Configuración MFA enabled=false/cohortNULL verificada por SQL. Dos factores TOTP del propietario siguen verificados. Sesiones recientes AAL2 trasTOTP; no se modificaron Auth ni factores.
- Frontend MFA presente con arranque fail-open cuando enabled=false y cobertura de regresión; las restricciones explícitas conocidas no se borran por fallo deRPC. Bundle verificado tras#244:index-DIsFGH6G.js. La nueva corrección de carrier es backend; el recibo#245 registra el despliegue final y el bundle servido.
- Cronworker y productor cada 5 min; orquestador hora:07; mantenimiento:13/28/43/58; retención */10 1-3 * * * UTC (03:00–05:50Madrid hoy). No se alteraron horarios durante el último fix.
- No se compraron etiquetas en las verificaciones. Endpoint temporal de evidencia retirado410 tras#243.
- Hipótesis de cierres AAL1 a 15 min **no confirmada**: logs prueban login/TOTP/AAL2 y un refresh inválido cercano sin atribución suficiente. Ver20261019-auth-session-evidence.md. Un rollback sin desafío puede ser incompatible si Auth limita AAL1; no afirmar que cualquier rollback cierra toda sesión cada 15 min.

## Desviaciones y límites

- Primer intento agrupado429 de Amazon: recuperado en reintento sin avance prematuro de checkpoints. Ventanas grandes aún se reproducen completas al agotar presupuesto; no hay cursor durable entre invocaciones.
- En parte de las comprobaciones el cronworker corrió antes del productor y dejó el job para el siguiente ciclo; invocaciones explícitas del cron existentes están diferenciadas de ciclos naturales en los recibos.
- Hubo57014 en ensayo controlado de snapshot de retención; se corrigió la consulta aEXCEPT antes de aplicar. No se atribuye ese error al worker ni se afirma ausencia absoluta de errores todo el día.
- La ampliaciónSMALL y los cambios de carga son intervenciones distintas. La ausencia de errores en ventanas revisadas no demuestra ausencia fuera de esas ventanas.
- La paridad se contrasta con funciones antiguas sobre los mismos datos, a céntimos visibles y conteos exactos. El origen del carrier se verifica por el envío real; no se ajustan datos para hacer coincidir un número histórico.

## Rollback

Cada publicación conserva snapshot exacto, recibo y orden inverso en su diario. Frontend inmediato aindex-DIsFGH6G.js oindex-DB5LBqud.js según la fase; preferir bundles con desafío MFA frente al pre-MFA. RPCs aditivas pueden permanecer durante rollback de interfaz. Jobs agrupados requieren restaurar productores, convertir/vaciar agrupados y después retirar worker compatible; SQL de conversión probado. Retención puede deshabilitarse con su kill switch y restaurar terminales del respaldo protegido. #245 conserva las tres funciones previas y metadatos del único envío investigado (no se necesitó reparación manual); no modifica coste ni etiqueta.

## Pendientes priorizados

1. **Reactivación MFA.** Verificar configuraciónAuth y duraciónAAL1, piloto del propietario presente, enabled/cohort controlados y evidenciaRPC/Edge/bridge/AAL2. Preservar fail-open cuando esté apagado y arranque sin bloqueo por BD lenta. No reactivar en este cierre.
2. **Token propio Amazon por workspace en Integraciones.** Retirar fallbackglobal, migración por cuenta con verificación de SP-API y rollback, sin alterar acceso de otros tenants.
3. **Solicitud de desarrollador público SP-API.** Preparar aplicación, permisos y evidencias de controles; distinguir solicitud del despliegue técnico.
4. **Ampliación MFA según política Amazon.** Tras piloto estable, ampliar cohort y roles de forma gradual, con pruebas de recuperación, delegaciones y sesiones; no activar globalmente por anticipado.

Fuera del cierre de rendimiento: el propietario corregirá el carrier histórico en Amazon; los informes pueden seguir el envío real local sin esperar a ese cambio. InvoiceEngine#236 y demás trabajo funcional se revisan por separado.

## Recibos de referencia

20261019-retention-capacity.md;20261019-retention-drain-receipts.json;20261019-amazon-write-receipt.json;20261019-amazon-write-natural-cycle.json;20261019-grouped-jobs-release.md;20261019-grouped-jobs-receipt.json;20261019-orders-dashboard-production-receipt.json;20261019-orders-tariff-kpi-receipt.json;20261019-carrier-attribution-release.md. Los recibos finales se conservan en audit/production-resume-20261019 para evitar despliegues de interfaz por cambios únicamente de diario.

## Última publicación de integridad

#245 fusionada con cinco CI verdes en53685e5916b8e329eb147887b0dbdb13f04bf2d1; merge6c5b6a42e226c79e9ba96877c240adbeeebaae1f. Columna aditiva marketplace_carrier, migración20261019145139. Versiones worker42/orders24/reconcile12; solo parche revisado en bundles vivos y JWT/dependencias preservados. Pruebas:145Vitest,1128Node,48regresiones de bundles. No reparación manual de datos. El recibo final añade el ciclo natural tras esta última variante.

## Cierre operativo17:06Madrid

Última versión verificada en ciclo natural17:05: dosjobs correctos,240registros porjob,4.959/4.075ms; cola vacía,0failed y lease liberado. Integridad del envío real y last_synced_at conservados. Cinco periodos sin diferencia tras el ciclo final; trimestre MRW190,00€ + Correos64,73€ =254,73€,58/58. Vercel READYdpl_4yNticX5jfyyibqMe2yChVxp6rfH y dominio con index-DIsFGH6G.js, HTTP200. MFA continúa enabled=false/cohortNULL. Ventana de logs15:01:50–15:05:45UTC sinPGRST003/57014/lease_lost. Bloque de rendimiento e integridad cerrado con los límites y pendientes anteriores.
