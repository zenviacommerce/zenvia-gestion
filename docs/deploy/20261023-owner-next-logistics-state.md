# Owner decision — after visual hotfix

Sequence: publish the authorized visual Tabs/search/support/pickup-history hotfix first. Then deliver the verifiable shipment checklist in pickup signing together with real internal logistics state. The checklist was already published in PR294; verify its current production reachability again before claiming it available. Then resume paused automatic creation reconciliation (../zenvia-mrw-recovery, fe15f7a), then cancellation PR292 and remaining backlog.

Internal state is independent of marketplace confirmation. Marketplace tracking/shipment confirmation stays at label generation, unchanged for Amazon on-time shipping metrics and Shopify.

- Pending: no active label.
- Labelled: active label, physically still in warehouse; source for pickup reports.
- Shipped: first of effective shipment membership in a signed pickup report, normalized first carrier movement (picked up/in_transit/out_for_delivery/delivered), or individual/bulk audited Mark as shipped action.
- Exception/delivered/cancelled: current normalized tracking behavior.
- Persist sent-at and cause (signed report, tracking, manual), actor where relevant.
- Removing a report line before signature leaves the order Labelled.
- Labelled queue warns after configurable X uncollected hours (choose existing settings if suitable).
- Before any migration/backfill show exact count of current labelled orders with neither first movement nor signed report; most existing tracked orders must stay Shipped. No mass reprocessing without prior count; show exact production UPDATE before execution per standing rule.
- Tests and screenshots of label creation → Labelled → report → signature → Shipped, plus counters and individual/bulk manual actions. Stop before publication; owner did not authorize this feature's publication.

This file records the decision only. No production data or marketplace behavior changed.
