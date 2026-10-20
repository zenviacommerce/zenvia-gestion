# 2026-10-20 — PR#250 published

Customer freshness fix merged as c512720ad2429520c897b2961002cf8948cf53b8 after five required checks succeeded on exact head dda382ea16491f13d00cc4ac6b6fbb495412d9bb. Run IDs and deployment receipt:20261020-shared-entity-release.json. Vercel dpl_3Mznkx6P7AMfybJtSLch4xVmp2Vz READY and assigned to gestion.zenviacommerce.com. Public HTML and index-CRlr5KXE.js HTTP200; entity event code present, synthetic screenshot banner absent.183Vitest/1130Node/build passed. Existing Shopify VM harness dependency stub corrected after first CI failure; no checks bypassed. Independent review findings addressed. Full audit/cause/captures/rollback in main docs/deploy/20261020-shared-entity-refresh.md.

Entities: clients in retained billing/invoice/receipt selectors; products in billing/receipts and shared Amazon/Shopify mapping; supplier successful CRUD/expense-import updates reach shared AppData/Gastos; tariff/account changes refresh retained Orders statuses/tariffs and invalidate outstanding single/bulk quote previews. Client dropdown refreshes after5s and uses debounced server search; drafts and typed search preserved. No Auth/MFA/SQL/Edge deployment or configuration changes.

Rollback recorded before merge: dpl_DLT8CGvp4zuFH7yQurn734LUYaS4 / index-DqmjjHIX.js. No DB rollback required. Owner browser acceptance of customer fix pending; no real commercial clients/invoices/receipts/labels created by verification.

Post-release07:20:37UTC: pilot enabled, exact owner-only cohort, guard0; normal worker cycle succeeded through07:20:09.806UTC,0running,0liveleases,0failedjobs/cron in last hour. Owner's MFA pilot acceptance documented separately. Hourly48h surveillance resumed as requested.
