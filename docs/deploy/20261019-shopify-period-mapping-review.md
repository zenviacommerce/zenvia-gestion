# PR247 — period mapping visual review

The previous screenshot used a synthetic constant response (220.02/11/17 for every range). This invalid fixture made the forecast subtract identical month/today totals and display zero. No production/frontend mapping defect was found; the component already maps results by ID.

On19 October as authenticated owner/AAL2, BEGIN/ROLLBACK: batch JSON exactly equals each legacy individual RPC for Today, Yesterday, current month and previous month (all fields). Captured aggregates in tests/fixtures/shopify-period-production-20261019.json contain no customer data. Forecast uses unchanged client algorithm and is pinned by explicit expected values.

| Card | Gross EUR | Orders/units | Refund gross/count | Display margin |
|---|---:|---|---|---|
| Today |23.98|1/2|0/0|64.7%|
| Yesterday |0|0/0|0/0|No sales|
| Current month |220.02|11/17|0/0|65%|
| Forecast |337.62|17/26|0/0|100%|
| Previous month |35.98|1/2|0/0|100%|

The100% provisional margins reproduce the existing calculation with unknown product/shipping cost; no margin rule changes are part of this review.

Regression renders real cards with batch results deliberately reversed, then asserts each card gross, counts, refunds and margin. Mutation test intentionally changed ID assignment to positional assignment: FAILED Today gross35.98 instead of23.98; original restored:PASS. Screenshots use the same captured aggregate fixture, fixed19 October date, one batch and reversed response; product row is synthetic. No network or provider calls.

Frontend remains unmerged and unpublished. No production migration/function changes in this follow-up. Await owner visual approval.
