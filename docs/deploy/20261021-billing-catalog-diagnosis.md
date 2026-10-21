# Diagnóstico de catálogo y contratación — 2026-10-21

Estado: diagnóstico terminado; sin corrección ni despliegue. Detención solicitada antes de cambios en PayPal.
Estimación inicial: 25–40 minutos. Siguiente corrección estimada: 2–3 horas, sujeta a revisión visual antes de publicación.

## Alcance y límites
Consultas SELECT a ambos proyectos Supabase; lectura del código desplegado de customer-billing v10, customer-billing-api v2, customer-plan-sync v6, platform-admin v39 y platform-bridge v32; código main de Gestión; comprobación visual de precios mensuales y anuales en producción.
Consulta OAuth de acceso y seis GET /v1/billing/plans/{id} contra PayPal sandbox. No POST de creación de planes o suscripciones, ni modificación de PayPal.
Sin facturas, cambios de suscripciones, cambios MFA ni escrituras de datos de producción. Credenciales temporales eliminadas tras las consultas.
Referencia main inspeccionada: ee11f1d49855fc324376c91f7e3d9304b4dcdc33.

## Evidencia de precios (EUR, base antes de impuestos)
| Plan | Gestión mensual | Platform mensual | Gestión anual | Platform anual |
| --- | ---: | ---: | ---: | ---: |
| Starter | 29,99 (oculto: is_public=false) | 39,99 | 299,99 (oculto) | 439,89 |
| Pro | 39,99 | 49,99 | 399,99 | 549,89 |
| Business | 49,99 | 55,99 | 499,99 | 615,89 |

Platform: tres planes comerciales activos y públicos, current_version=5. Interno v4, sin precio y no público.
Gestión conserva filas de septiembre: Starter actualizado el 28/09; Pro y Business el 26/09.
La tabla local ni siquiera tiene current_version. La diferencia está almacenada en base de datos; no se resuelve recargando la pantalla.

## Flujo y causa
1. src/services/billing.ts llama a customer-billing en el Supabase de Gestión.
2. Esa función lee public.billing_plans LOCAL, sin catálogo central ni versión comercial.
3. El frontend filtra is_public y por eso omite Starter.
4. startCustomerPayPalCheckout envía únicamente planKey y cycle a customer-billing-api de Platform. No envía precio ni versión esperados.
5. customer-billing-api selecciona el plan público ACTUAL de Platform y metadata.paypal[mode].monthly_plan_id/yearly_plan_id, y crea una solicitud de suscripción con ese plan_id.
6. Por tanto, el botón Pro mostrado a 39,99 seleccionaría un plan base de 49,99; Business mostrado a 49,99 seleccionaría 55,99. En anual: 399,99 frente a 549,89 y 499,99 frente a 615,89.
7. customer-plan-sync envía nombre, versión funcional, permisos y estado a apply_plan_snapshot. No transmite precios ni todo el catálogo público. El receptor actualiza workspace_subscriptions/app_subscription_state, no billing_plans.
8. platform_update_plan incrementa current_version SOLO si cambian entitlements. Los snapshots v5 no contienen precios; cambiar precio/publicación por sí solo no crea versión comercial ni encola sincronización.
9. sync_paypal_catalog es una acción manual independiente; compara importes guardados en metadata, reutiliza IDs o crea otros. No comprueba por GET el importe vigente antes del checkout. Su comprobación catalogReady también compara metadata, no PayPal directamente.
10. No ejecutar sync_paypal_catalog como diagnóstico: puede crear planes y encola sincronizaciones de suscripciones.

## PayPal comprobado directamente
paypal_mode=sandbox. Las seis respuestas GET devuelven ACTIVE y frecuencia MONTH/YEAR con intervalo 1; sin setup fee; todos los precios EUR coinciden con Platform.
| Plan | Periodo | plan_id seleccionado | Importe base |
| --- | --- | --- | ---: |
| Starter | Mensual | P-7T598320DP071480TNLMN3MQ | 39,99 |
| Starter | Anual | P-19Y788404M9261026NLMN3MQ | 439,89 |
| Pro | Mensual | P-6D2660966E5761107NLMN3MY | 49,99 |
| Pro | Anual | P-30050824NM153664ANLMN3NA | 549,89 |
| Business | Mensual | P-5PX35064XW647273VNLMN3NA | 55,99 |
| Business | Anual | P-2W947710639309825NLMN3NI | 615,89 |

Planes sincronizados el 21/10, aproximadamente 15:43:46–49 UTC. No hay metadata de planes live en estas filas.
El código usa sandbox actualmente: no hay cobro real con esta configuración. No se ha creado ninguna solicitud para probarlo.
Fiscalidad global: domestic_tax_rate=21, prices_include_tax=false. El checkout aplica el tratamiento del perfil fiscal concreto; los importes de esta tabla no incluyen ese impuesto.

## Recomendación para la corrección (pendiente)
- Bloquear temporalmente nuevas contrataciones discrepantes; no modificar suscripciones existentes.
- Catálogo comercial central en Platform, con versión/revisión económica explícita y precio, moneda, periodicidad e impuestos coherentes en Gestión.
- Validar en servidor precio y revisión mostrados frente a catálogo publicado y PayPal; rechazar discrepancias antes de crear la solicitud de suscripción.
- Publicación consistente: preparar mappings inmutables por entorno y revisión, validar con GET, publicar solo cuando todo esté listo. Mantener mappings antiguos para suscripciones existentes.
- Comprobación automática acotada por GET a PayPal con alertas y fecha de última verificación. No fiarse solo de metadata.
- Pruebas: Starter visible, igualdad mensual/anual, cambio solo de precio genera revisión comercial, checkout obsoleto rechazado, mismatch de PayPal bloqueado, sin escrituras sobre suscripciones existentes.
- Capturas antes/después a 390/1280/1440; CI; DETENER antes de publicar salvo nueva autorización explícita.
- Antes de cambios de producción: snapshot y rollback concretos. No se necesita rollback de datos para este diagnóstico porque no modifica producción.

## Orden de trabajo vigente
Platform terminado: @zenvia/ui y lotes A/B/C; no repetir.
1. Resolver inconsistencias de planes tras presentar este diagnóstico; detener antes de tocar PayPal.
2. Gestión: seguimiento de envíos (prioridad alta), luego resto del backlog.
3. MFA y ampliación, solicitud pública SP-API, validación de cifras de Amazon. Piloto MFA actual intacto.

### Seguimiento de envíos pendiente
Evidencia aportada por el propietario: 36 Sendcloud/MRW SHIPPED y 29 MRW directo SHIPPED, más 4 READY_TO_SEND; tracking MRW sin actualizaciones desde el 19/10. No revalidada en este diagnóstico de facturación.
Diagnóstico por MRW directo, Sendcloud y Envia; códigos comunes pre_transit, in_transit, out_for_delivery, delivered, exception, returned, cancelled conservando detalle original; distinguir ausente, recogida pendiente y demás detalle. Webhooks y sondeo acotado con backoff, observabilidad y cese de consulta de entregados. Pedidos con fecha de estado, filtro de incidencias y aviso configurable de estancamiento. Reprocesar activos con SQL exacto y alcance previo a cualquier UPDATE de producción.

### Resto de Gestión
Registrar envío externo; reetiquetar tras cancelar; cancelar desde Zenvia; estado Cancelado según código, no texto; eliminar pedidos con papelera (diseño primero); Sin coste en vez de Margen 100 %; Amazon Mes anterior (referencia 331 ms); token propio Amazon en Integraciones.
