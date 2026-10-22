# Publication receipt — 22 October 2026

PR #286, reviewed product head `7f585755b4b04912fcfcbc83aaf65ac016db28c9`, tree `b33c0e160e15dfcc8589eea1653bccfa5efe1629`.

Tracking production receipt: 8 carrier-account associations repaired, 7 non-terminal shipments queried (5 delivered / MRW 00; 2 out for delivery / MRW 16 with movements on 22 October), zero errors. One pre-existing delivered Shopify/MRW shipment excluded; 84 Amazon historical terminal shipments excluded. Subsequent 45-day audit: zero missing active shipments in all reviewed channel/provider groups. Shopify importer v15 verified against captured v14: only index.ts changed, exactly the removed NULL assignment; every shared dependency and existing JWT verification setting identical. MFA pilot untouched.

Production UI before check: at 390px native details `open=true`, computed ancestor overflow `auto hidden`, and all four old menu controls fail center hit-testing, confirming the same clipping as the fixture. Dates observed as DD/MM/YYYY.

Local full historical-baseline visual rerun: 21 views, three dark smoke checks, action and column parity at 390/1280/1440, no failures. New touch test enables hasTouch, taps More, verifies hit-testing, opens tariffs and returns. No live label, document or invoice creation.

CI first attempt: five workflows passed. Visual workflow 39790430582 / job 119864714018 exhausted its 15-minute job timeout after the Ubuntu Azure mirror dependency downloads consumed almost 13 minutes (including a 391-second download stall). MFA render passed and all 42 Orders screenshot cases logged no failures before cancellation; later checks were skipped, so this attempt is not treated as green. Retry only the visual job on a fresh runner; do not bypass checks or publish until success.

Publication pending visual CI success. Rollback target remains deployment `dpl_7vBQnPC6hWVntVa7B8aNfh4AVHhc`, project `prj_L6nGgpq78QTEnZByUNtjtmF5rGkv`.

Visual-only retry accepted after the first run finished its artifact cleanup. Product SHA unchanged; the five passing workflows are retained. No workflow weakening, skipped gates or CI configuration changes.
