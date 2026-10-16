# Eight outdated tests updated after intended behavior was confirmed

Reproduced on untouched main 840e2f201f0b981f7962ebfe3e2919993faa34ce on 2026-10-16. Command: `node --test --test-reporter=tap scripts/*.test.mjs`. Actual result: exit 1; 985 tests, 977 passing, 8 failing, none skipped. These are the same eight cases reported before the Auth release. This PR changes documentation only; no test, application, Edge or migration code is changed, skipped or repaired.

Probable causes below are triage, not approval to change expectations. Before a later fix, establish the intended behavior and add/retain a test that checks that behavior.

| Test | File | Observed failure | Probable cause and follow-up |
|---|---|---|---|
| forecast is a distinct estimate and selecting it shows actual month products | scripts/amazon-dashboard-interactions.test.mjs | Expected end date 2026-10-14; actual 2026-10-16. | Fixture assumes a fixed calendar date while the component uses the real current day. Verify with a controlled clock before considering product changes. |
| manual orders-only sync returns the actual job IDs and keeps other sources unchanged | scripts/amazon-manual-order-jobs.test.mjs | Second call leaves captured sources as ['orders'] rather than ['orders','finances','inventory']. | The second call enables recovery; its fake query chain lacks `.limit()`, while the handler executes `.order(...).limit(1000)` before enqueueing. The handler catches that error, returns 500, and the test does not assert this second HTTP status. The captured sources can remain from the first call. Verify the second response before deciding the real endpoint drops sources. |
| Amazon series trends net profit rather than pre-Ads profit | scripts/amazon-profitability-kpis.test.mjs | Source regex dataKey="netProfit" absent in AmazonSummary + AmazonPeriodCards. | Static assertion assumes an older chart structure. Current cards expose data-metric="netProfit" and no corresponding dataKey chart. Determine which chart currently owns the metric and whether the requirement still applies; do not merely weaken the regex. |
| Amazon page retains live status and manual sync without external shortcuts | scripts/amazon-status-ui.test.mjs | Source regex “Sincronizar ahora” absent. | Current button label is “Actualizar datos”, still wired to syncNow. The string assertion appears stale; verify action and accessibility label against intended UI. |
| orchestrator and worker are internal-only and worker claims bounded jobs atomically | scripts/amazon-sync-queue.test.mjs | Source regex limit_count:4 fails. | Phase 1 intentionally reduced claims to limit_count:1 under a lease. Test predates that design. Future test should verify internal auth, ownership and bounded claims, not restore four jobs to satisfy it. |
| manual sync handles an immediately drained queue without leaving stale pending state | scripts/amazon-sync-throughput-chart.test.mjs | Regex else if(result.jobs) fails. | Current branch is else if(result.jobs||result.recoveryJobs). Structural assertion excludes the added recovery case. Verify actual pending-state transitions rather than treating this as a product failure. |
| Gmail checkboxes import a selected batch and advance through manual reviews | scripts/gmail-bulk-ui.test.mjs | ReferenceError: getGmailBackgroundState is not defined. | Harness strips imports and evaluates GmailPage in a custom VM without supplying the new background-import dependency. Production imports that function normally. Supply realistic test dependencies later and re-evaluate intended background/manual review behavior. |
| full product table has 11 columns, scoped mapping action and works through the full list | scripts/shopify-analytics-ui.test.mjs | Expected 11 headers; actual 12. | Structural count is out of sync with the current table (including selection). Confirm intended columns and test by semantics before changing a fixed count. |

## Scope and release relationship

PR #214 has 20 passing real-SDK Auth tests and a passing production build. This inherited Node-suite backlog is separate. The full Node workflow is still red; this document does not claim it is green or waive it silently. The user explicitly approved the Auth release with these eight failures deferred.

## Approved expectation updates (2026-10-16)

The user confirmed all eight contracts are intentional. This PR now updates only the eight test files listed above. The forecast expectation follows the Europe/Madrid calendar day; manual recovery mocks support limit and assert the second HTTP result; cards assert the current net-profit metric; button text, claim size, recovery branch and table width match the intended UI/worker. Gmail's harness executes the real background-import module and keeps its sequential review assertions. No product code was changed and no actual product bug was identified.

Validation: `node --test --test-reporter=tap scripts/*.test.mjs`: **985 passed, 0 failed, 0 skipped**. Historical red results above are preserved as before/after evidence, not current status.
