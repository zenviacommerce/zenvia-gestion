# Shopify mapping RPC: stale parameter qualifier after MFA cloning

## Incident and exact reproduction

Variant/SKU gid://shopify/ProductVariant/57896618983756, ZENVIA COMMERCE account5ae60ea5-e45c-435a-ae72-96a9043cd0c0. Calling public.shopify_get_product_mappings(uuid,text) as authenticated with the owner's actual sub/AAL2 and an existing session, in BEGIN/ROLLBACK, reproduced42P01 missing FROM-clause entry for table shopify_get_product_mappings. The modal itself is unaffected; the read fails inside private.mfa_impl_3790982.

## Cause and history

Both wrapper and implementation are PL/pgSQL. This is not a SQL-language conversion issue. The original function of20261014114444_shopify_readonly_analytics qualified parameters with its own implicit PL/pgSQL block name. MFA installer20261016191517 cloned it by changing only the CREATE FUNCTION header. After the explicit rollback20261018092127 restored the original public definition (snapshot includes both qualifiers), reinstall20261018121500 repeated the cloning mechanism. That is the most recent applicable wrapping migration and the current manifest records the exact pre-wrapper definition. The clone kept shopify_get_product_mappings.integration_account_id/.seller_sku, but its implicit block is now named mfa_impl_3790982. Today's performance migrations did not change this business body.

## Complete pattern audit

226 functions: public90PLpgSQL+16SQL; private89PLpgSQL+31SQL. All34MFA manifest implementations checked against their original names. Whitespace/quoted-name-normalized SQL self-qualification audit also ran. Reproducible read-only query: scripts/sql/audit_function_parameter_qualifiers.sql.

| Function | Result |
|---|---|
| public.shopify_get_product_mappings(uuid,text) → private.mfa_impl_3790982(uuid,text) | Only affected implementation: two stale parameter qualifiers |
| public.shopify_delete_product_mapping_item(uuid,text,uuid) | Own-name qualifier is valid PL/pgSQL; not renamed; no defect from this pattern |
| public.shopify_add_product_mapping / shopify_create_product_and_mapping | No stale qualifier |
| public.amazon_get_product_mappings / add / set / delete / delete_item and their MFA implementations | No stale qualifier; get RPC verified with actual authenticated claims |
| public.amazon_create_product_and_mapping | No stale qualifier |
| private.amazon_mapping_cost_snapshot / amazon_historical_unit_cost_eur | SQL with ordinary parameter names, no own-name/stale qualifier; downstream Amazon products/costs read verified |
| Remaining226-function scope | No other stale renamed qualifier; SQL self-qualification matches0 |

Amazon frontend additionally reads products.last_cost/cost_unit/base_unit under RLS after amazon_get_product_mappings. The production read test found one mapping and its cost-bearing product; amazon_analytics_products returned four matching rows without SQL errors.

## Correction, rollback and integration

Only change the private clone body: replace the two qualified parameters by$1/$2. Resolve the implementation through the manifest, validate wrapper hash, language, argument names and SECURITY DEFINER, and preserve public wrapper/OID/hash/ACL, implementation security/volatility/search_path/owner/ACL and historical original_definition. Assert no other manifest clone retains an old-name qualifier. No MFA flags, cohort, factors, sessions, Edge Functions or frontend changes.

Before snapshot: supabase/snapshots/20261019-shopify-mapping-rpc/before.json. Exact body rollback: supabase/rollback/20261019_shopify_mapping_qualifiers_before.sql. Reapplying it restores the failing business body only, never removes MFA; use only if correction causes a regression.

Integration in tests/mfa-sql.test.ts installs the exact original production business function, then the real MFA migration, reproduces42P01, applies this repair, verifies nonempty mapping result, wrong-store/SKU/owner isolation, actual SET ROLE authenticated call, MFA denialAAL1/allowAAL2, private EXECUTE restrictions and unchanged function metadata. Focused39passed; complete146Vitestpassed before final metadata/assertion strengthening. Independent code review found no blockers; its caller-role suggestion was incorporated.

## Deployment sequence

CI first; additive repair migration only; production call replay and Amazon mapping/cost smoke in rollback transactions. Align repository filename to actual migration ledger version, then merge with green CI. Backend is sufficient to restore the existing modal; no UI publication required. Journal receipt follows with actual results.

## Hotfix aplicado 20261019162221

Desviación operativa explícita: GitHub mantuvo los cinco workflows queued sin runner asignado. Para restaurar la incidencia se aplicó únicamente el parche SQL tras39tests de integración,146Vitest,1128Node,build y revisión independiente aprobados. No se declaró CI verde ni se fusionó main; la fusión sigue condicionada a CI. Nombre del fichero alineado a la versión real del ledger para evitar reaplicación.

Reproducción posterior con mismo sub/AAL2/rol authenticated: SKU afectado devuelve1vínculo; otra tienda0; Amazonget1 y producto con coste1. Shopifyadd/delete y Amazonadd/set/delete_item/delete ejecutados dentro deBEGIN/ROLLBACK sin cambios persistidos. Helpers internos Amazon: mapping_count1, unit_cost_eur2,90, sin coste histórico/FX pendiente; coste histórico presente. La llamada interna de helpers se hizo con el rol de inspección, y el camino público de costes con authenticated.

Comparación exacta del cuerpo: solo dos sustituciones; wrapper hash ok, prolang/prosecdef/provolatile/proowner/proacl/proconfig conservados. Escaneo posterior de34clones:0calificadores obsoletos; MFAenabled=false/cohortNULL sin cambio. La interfaz no necesita nuevo bundle. Se avisa al usuario para comprobación en navegador; CI remoto pendiente de runner.

## Cierre de verificación de producción

Sin nuevos missingFROM de shopify_get_product_mappings entre16:22:21UTC y la captura final del recibo. El error inicial se reprodujo deliberadamente y se conserva como evidencia, no se oculta en el recuento posterior. Escaneo final226funciones/34clones con0referencias obsoletas. Recibo20261019-shopify-mapping-rpc-receipt.json. Todos los workflows aúnqueued/sinrunner en la última lectura; PR246abierta sinfusionar. Se avisa al usuario para revisar vinculaciónShopify yAmazon en su sesión real.
