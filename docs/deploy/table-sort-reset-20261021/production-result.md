# Publicación del hotfix de ordenación — 21/10/2026

PR [#271](https://github.com/zenviacommerce/zenvia-gestion/pull/271) publicada de forma independiente después de facturación #270. Main `45441a470dd2ff30fc4d78020a0cc1309290bf6d`; árbol idéntico al commit probado. Vercel `dpl_CB76xZWQJmZppTwhoBE6LY8cYKVe`, READY/production, alias gestion.zenviacommerce.com. HTML público sirve `index-DMphM7HP.js`; JS descargado (2.853.010 bytes) contiene Restablecer orden, la clave de preferencias y la guarda de factura Shopify. Esto es comprobación del despliegue, no validación visual con sesión del propietario.

CI completa final 5/5 verde (Auth, integración desechable real GoTrue/Vault, revisión visual completa y dos builds); build posterior de main 39601792423 también verde. Local: 271 React y 1240 Node/SQL. Navegador sintético: selección de demo-0 y demo-25 conservada a través de páginas, asc/desc/predeterminado y reset explícito, botón dentro del viewport móvil.

Desviaciones: guardas de respuestas tardías añadidas a tres tablas Amazon después de pruebas RED; harness de maestros actualizado para el ciclo de tres estados, sin debilitar la selección. Tres tablas históricas Amazon conservan ordenación local sobre la página recibida, según sus RPC originales; no se afirma orden global nuevo. Soporte no tenía cabeceras ordenables; contrato anotado para Platform al migrarse.

Rollback: promover `dpl_22J1RTb1BF39etPX5Kcmkf5MtPQo` / main `946d932b7e0f705953f7ea228b7ff374f7cb876a` / bundle `index-DMsvERAZ.js`, o revertir solo #271. Conserva el hotfix fiscal #270; sin SQL ni mutaciones de datos.

[Capturas y contrato](https://github.com/zenviacommerce/zenvia-gestion/tree/main/docs/deploy/table-sort-reset-20261021). Registro postpublicación en rama de auditoría, sin fusionar documentación a main ni provocar otro despliegue.
