# Orders pagination and complete filtered selection — PR237

Approved: page selection offers all eligible matching IDs, then previews and generates the exact saved selection across pages. Keep configured page size. Limit 2,000; overflow returns no IDs and instructs the user to narrow filters. Filters or workspace changes invalidate selection; global selection survives page navigation. Revalidate saved IDs against live pending/unpurged eligibility before quoting. New arrivals are never silently added; missing IDs abort.

Core RPC shares classification/filter/dedupe scope with the IDs wrapper. SECURITY INVOKER, tenant RLS, empty search_path; EXECUTE only authenticated/service_role. No exclusive shipping lease for selecting or quoting. Existing creation exclusivity unchanged. No labels purchased in release verification.

Test-first failures observed for missing selection service, missing select-all UI, and bulk quote batches continuing after a workspace change. Focused regressions now pass. Real PostgreSQL-compatible tests exercise RLS, dedupe, filters, 63 IDs across 25/25/13 rows, live invalidation, empty scope and overflow without truncation. Playwright desktop/mobile confirms page25 → all63 → page2 preserves63 →63 unique mock quotes. Purchase confirmation never clicked. Fixture banner remains harness-only.

Production preflight 13:45:41UTC: both dashboard and IDs RPCs absent. Previous frontend accepted bundle index-BTiT_pl4.js, deployment dpl_FVjSSCg41z7RBdCLFPSz1PzMUYJa; emergency index-BkauntMi.js deployment dpl_3W2T4KqMQYqspkCT6FAupXTH2jba retained. Snapshot of absent functions and exact rollback prepared before schema change.

Order: final CI/captures → apply RPC migration → authenticated-role production KPI and ID checks → align migration filename to actual ledger → final CI → merge frontend → Vercel READY and public bundle check. Stop if backend parity/RLS fails. Rollback frontend first, then drop the two new functions if required; old frontend needs neither function. Never drop backend while a new frontend is still being served.

Status: implementation complete locally; production not changed. Backend and frontend publication authorized by Sergio after passing checks and new capture.


13:54:36UTC applied initial migration ledger20261019135436 after all5CIgreen on f25e62cd. Bothfunctions priorabsent snapshot in repo. Authenticated-role/RLS proof: real2pendingIDs returned and recovered exactly; p_limit1 gives exceeded+emptyIDs; anonEXECUTEfalse, authtrue, SECURITYINVOKER. Five periods exact KPI JSON equal against independent baseline at13:55:50UTC, including sales/states/transport.

Performance gate caught8,859.129ms RPC. Instrumented regression exposed216 jsonb_populate_record evaluations for3deduped rows (72columns each). New follow-up migration evaluates once using a lateral record source:3calls for3rows, exactfullJSONparity. Read-only production candidate EXPLAIN under authenticated role:637.818ms, not deployed yet. Frontend remains oldbundle. Original applied migration is preserved; follow-up requires CI and separate deployment. Initial migration filename aligned to actualledger. Visible-page checkbox now excludes/includes only currentpage from global snapshot, not clearing otherpages; test proved38remaining then63restored.

Read-only production prototype637.818ms vs installed initial8859.129ms; newmigration pending5CIgreen. HTTPanon401/42501 forbothRPConly, schema cache resolved. CurrentfrontendremainsBTiT_pl4; no labels created. CIhead e852d98f04552fa11b56e6447e3bbf8420885954 all4fastgatesgreen, Auth/Vault startup pending. Local138Vitestpass;1124scripts pass (gatedAuth/Vault tested inCI).

14:06:44UTC applied record-once optimization after5CIgreen; ledger20261019140644. Actual authenticated RPC EXPLAIN700.602ms (~92.1% reduction from8859.129). Post-optimization five periods states/counts exact and all money cents match baseline; saved receipt float serialization requires cents normalization, not a product data difference. Core full JSON parity separately proven bySQL instrumentation test. IDs re-read afteroptimization2of2 exact at14:09:44UTC. Both appliedfileversions nowalignedwithledger. Finalcommitb6b14838b19772296ddee4d8d94424205ecbeba0 onlychangesfilename/testpath; CIinprogress. Frontendnotmerged. Next:5green→merge237→VercelREADY/alias/bundle→notifySergio. No labels bought.

14:14UTC finalheadb6b14838b19772296ddee4d8d94424205ecbeba0 all5CIgreen; main/alias rechecked unchanged58bad/BTiT_pl4 beforemerge. PR237 ready and merged4fa95260592cd1208d27252e975e16de4027b10d. Vercelbuild pending. Latestworker14:00/05/10allfirstattemptsuccess3.667–5.353s; leasefree. OptionalSupabase logquery returnedbackendserviceerror, so no assertion of zero logerrors from that request. No labelscreated.
