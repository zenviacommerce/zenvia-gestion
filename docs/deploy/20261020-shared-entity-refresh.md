# 2026-10-20 — Shared entity selector freshness

## Cause and fix
Facturación is wrapped by RetainedImportPage. SalesInvoicesCore and SalesReceipts copied clients/products into component state in a mount-only effect. Client CRUD persisted in SQL and refreshed Clientes, but never invalidated retained billing copies. This is duplicated React state, not TanStack staleTime or sessionStorage view cache.

Successful CRUD now emits a payload-free entity change. Retained consumers re-read through their current Supabase/RLS client. Bursts coalesce; listeners unsubscribe. No global record cache is added. Invoice/receipt modals independently refresh clients on mount and dropdown opening after5seconds. Search queries the server after300ms debounce, sanitized PostgREST filters,100results maximum. Outdated responses are ignored. Options updates preserve the typed search and invoice draft (previous initialization dependencies would reset notes/lines when clients changed). Failed reads show an error and retry.

## Entity audit
| Entity | Affected consumer | Resolution |
|---|---|---|
| Clients | Retained billing tools, invoice and receipt editors | CRUD/cleanup/imported order client invalidation; independent refresh and remote search in both editors |
| Suppliers | Gastos selectors get live AppData props already; standalone supplier loaders mount afresh | Common successful CRUD and expense-import events refresh AppData; existing local CRUD refresh retained |
| Products | Retained invoice/receipt catalogs and Amazon/Shopify shared mapping editor | Successful product CRUD, expense reconciliation and mapping-created/SKU-assigned products publish; consumers refresh; mapping keeps existing remote search |
| Transport tariffs | Retained Orders list/KPIs/label modal | Review/activation/edit/delete events refresh tariffs; stale open quote dialog closes to require new quote |
| Integration accounts/carriers | Retained Orders provider status | Account mutations/connect/disconnect/default/test notify only after successful server response; refresh statuses and invalidate stale dialog. Account settings and Amazon/Shopify screens mount afresh |

All production SQL/Edge/Auth/MFA configuration and frontend enforcement flag are unchanged. Tenant/user retained boundaries remain. No invoice/receipt/label purchases or live test clients created for verification.

## Verification
Red tests reproduced missing new client and query cleared on asynchronous options update. Real InvoiceModal/ReceiptModal + real addClient service tests with controlled database boundary cover creating/selecting without remount/reload, edits/deletes, failed writes, remote search,5-second stale open and draft preservation. Event tests cover all entity names, burst coalescing and cleanup. Integration-account tests prove post-success publication, none on failure. Independent review found/fixed pre-completion integration notification and missing expense-import products event, then found no further important issues.

Playwright offline screenshots use real modal/components/services with synthetic Supabase transport; scripts/entity-refresh-screenshots.mjs. Fixture banner and create control exist only inside this screenshot entry, never the app. Screenshots: entity-refresh-review-20261020/invoice-new-client.png and receipt-new-client.png.

Local suites: Node1130/1130 excluding the disposable Auth integration exactly as build workflow; plain wildcard initially included that dedicated suite and failed its RUN_LOCAL_AUTH_VAULT_TESTS precondition (no local GoTrue). Disposable suite is required in its dedicated CI workflow. Full Vitest/build and exact-head CI receipts recorded after completion. Build retains existing large-chunk warning.

## Rollback recorded before publication
Current production:480cfba0cc055881c328c9cc92add639c05753ba, dpl_DLT8CGvp4zuFH7yQurn734LUYaS4, index-DqmjjHIX.js, zenvia-gestion-kfj5n0igd-sergiorojasdiaz-7097.vercel.app. Instant Rollback to this deployment; no database rollback needed. User authorizes publishing this correction after green CI. No unrelated generated icon changes included.

## Pilot acceptance and surveillance
Owner confirms logout/login requested TOTP and normal app works; reload in AAL2 does not rechallenge. At06:59:11UTC20Oct: enabledtrue,single-user cohort,integrityguard0,last worker success06:55:07.477UTC,0failedjobs in last hour. Worker ran successfully after activation, not merely before it. Existing surveillance task resumed hourly for48checks from20Oct10:00Europe/Madrid, bounded through22Oct10:00; notices only significant incidents/final summary, emergency disable authorized for actual pilot regressions. No cohort expansion.

## CI correction before publication
First Build workflow39384740449 failed: legacy Shopify installed-app VM harness returned{} for newly imported entityChanges, so notifyEntityChanged was undefined. Updated harness to execute real entityChanges module (no window/server-safe) rather than skipping test. Local Node1130/1130 pass after correction. Added regressions invalidating outstanding bulk quotes on tariffs/integrations changes as well as tenant changes. Final Vitest183 tests and build evidence recorded by CI at final head. No checks bypassed.
