# Solicitud de aprobación del release logístico

Estado: revisión del propietario, sin escrituras de producción. Código de PR #297: `bc46de366b1cb3926773bf7fafdabf0be9d623bd`.

Las dos mejoras de uso están incorporadas: comprobación primero, scroll único y total declarado automático/editable con aviso. 715/715 pruebas completas en local, 27/27 específicas, build/TypeScript correctos. CI final: 6/6 workflows en verde, Vercel correcto. Integración real en Supabase desechable: 11/11, sin omisiones. [Recibo de CI](20261023-logistics-ci-receipt.json).

## SQL exacto y rollback

- [Transacción completa: esquema y backfill atómico](https://github.com/zenviacommerce/zenvia-gestion/blob/bc46de366b1cb3926773bf7fafdabf0be9d623bd/docs/deploy/20261023-logistics-atomic-release.sql), SHA256 `e5568f336c54951f4dc58be29e0141bc6107e21c2c1b60230bc790fdcfc42ff9`.
- [Backfill exacto incluido en esa transacción](https://github.com/zenviacommerce/zenvia-gestion/blob/bc46de366b1cb3926773bf7fafdabf0be9d623bd/supabase/backfill/20261023_logistics_apply_after_approval.sql), SHA256 `9ea6d0a4d81cddf7e4c8e481161c5775d2cb35f142c59e87e9ab44d96781f2a1`.
- [Rollback SQL completo](https://github.com/zenviacommerce/zenvia-gestion/blob/bc46de366b1cb3926773bf7fafdabf0be9d623bd/supabase/rollback/20261023_internal_logistics_state.sql), SHA256 `050e82476fba30fb9abfe18ea4ca78fe2d031a0137289025e77cd51ab6272a0b`.

No se actualizan `source_status` ni las confirmaciones a Amazon/Shopify. La transacción inserta 356 evidencias y 591 registros históricos en tablas nuevas e inmutables (947 filas físicas). El guard exige cuenta y huella exactas; cualquier diferencia aborta el conjunto. La clasificación canónica cambia solo estos diez pedidos: 10 hacia Etiquetados, 933 conservan Enviados, 64 Cancelados, incluyendo 577 históricos canónicos conservados.

## Diez pedidos (consulta de solo lectura repetida)

| Canal | Pedido | Tracking | UUID |
| --- | --- | --- | --- |
| amazon | 171-1931838-4192365 | 01009F045767 | eb805c33-7133-4441-a00b-5ae041997d79 |
| amazon | 405-2267980-0898749 | 01009F045283 | 3a2ed5c9-0413-4d45-90e1-880483fa59fe |
| amazon | 405-8653611-5071509 | 01009F045768 | 96280e27-e38c-4726-a604-68fbb4dbc641 |
| amazon | 405-9438103-0776336 | 01009F045046 | 24d23f35-fc1f-4496-8fae-839e451676eb |
| amazon | 406-5011260-4807511 | 01009F045766 | 9c10e411-7cd1-42fd-b8e5-aabad923cfab |
| amazon | 406-9615891-5475566 | 01009F045774 | e9fe54e4-101b-44ce-aef7-ff3195d149d9 |
| amazon | 407-3816282-3253169 | 01009F045035 | 3b73b09a-bec2-452c-a1e3-ab27bb5789e9 |
| amazon | 407-8998792-9639500 | 01009F045286 | f4f8c754-a0ba-4b75-959c-671a4db30a7d |
| shopify | #1016 | 01009F045534 | 59c505d7-c611-4d1e-9879-a01cef43a7fa |
| shopify | #1026 | 01009F045775 | b3bc1225-4df6-4323-bbf0-f8f7171b882a |

[Consulta exacta](https://github.com/zenviacommerce/zenvia-gestion/blob/bc46de366b1cb3926773bf7fafdabf0be9d623bd/docs/deploy/20261023-logistics-ten-orders-preflight.sql) · [Resultado completo](https://github.com/zenviacommerce/zenvia-gestion/blob/bc46de366b1cb3926773bf7fafdabf0be9d623bd/docs/deploy/20261023-logistics-ten-orders.json).

## Secuencia tras aprobación expresa

1. Repetir preflight de solo lectura y comprobar las mismas cifras, identidades y huella. Si cambia, detener y presentar nueva propuesta.
2. Registrar snapshot/rollback y aplicar la transacción completa en Gestión `sjkxxbedkkmgmqnvaqjh`.
3. Verificar clasificación, aislamiento y contadores mediante lecturas; sin crear firmas, documentos, envíos, facturas ni correos reales.
4. Integrar PR #297 para publicación desde main, verificar despliegue y lecturas en producción, y avisar al propietario para comprobar el navegador.
5. Ante fallo, revertir frontend a main anterior `d3ddb4af4443f6c8f7a395181bf3b1e755b0379e`; drenar operaciones y aplicar rollback SQL anotado. Conserva evidencias/históricos y fuerza fallback hasta reconstrucción y paridad de la proyección. No borra hechos.

MFA piloto, PayPal, suscripciones y tareas posteriores fuera de este release.
