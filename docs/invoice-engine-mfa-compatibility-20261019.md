# PR #236: compatibility with the stable MFA deployment

Status: BLOCKED. Audit and isolated rehearsal only. No merge, deploy, production test write,
MFA configuration/user change, migration repair or secret access was performed.

## Pinned references and discrepancy

- Main: `9183ec1ead278a2d8fa7bb1f81240011fb58fc2a` (merge #235).
- Invoice HEAD before this audit-only addition: `cf630da8c55c21da1fbb89d8d49af6518ac92b82`.
- The invoice branch was 12 commits behind main, 3 ahead, with no three-way conflicts.
  Do not deploy that standalone branch: use the future combined main commit after approval.
- Last production frontend evidence in `docs/deploy/mfa-journal.md` at pilot acceptance:
  `f74ab6f8ca0048ea79e556f0f3b27465fa4e48bd`, deployment
  `dpl_GUjcgsVFJDXYWcLNmSYwiUvEhzLb`. This is a recorded observation, NOT a fresh live
  certification. Current production alias/commit cannot be certified: Vercel returns 403 for
  deployment listing and 404 for project/deployment lookup; CLI has no existing credentials.
- Supabase records 10 MFA migrations. Nine have canonical files in main with matching version,
  name and exact MD5 of the recorded SQL. **`20261018170000_mfa_strict_pilot_cohort` is applied
  in production but absent from main.** Do not repair/reconstruct it from the invoice branch.
  This prevents claiming main fully reproduces stable production MFA, despite green tests.
- The five deployed files of `platform-bridge` v31 (including shared MFA policy/helper) match
  main byte-for-byte. This is scoped source parity, not an authenticated bridge end-to-end test.

## Non-destructive merge rehearsal

`git merge-tree --write-tree` on the pinned refs produced tree
`39c40896847033b9de70af1d70165c14818b7fc1`, without moving any branch.
It preserves main's MFA context/screens/devices, auth transport, Supabase client, Edge tree,
migration tree and both MFA workflows exactly. The diff against main is invoice runtime,
tests, build CI and documentation only. No secrets, RLS, security functions or workers change.
The schema and authorization stubs under `tests/integration` are disposable fixtures, not
migrations, and must never be applied to a hosted project.

Local combined-tree results: 1,134 Node tests, 103 Vitest tests after adding the three
invoice auth-boundary checks, TypeScript and application build pass. PostgreSQL/PostgREST
invoice integration requires services unavailable locally; the remote job remains the gate.

## What the regression evidence proves

| Area | Executed evidence | Residual limitation |
| --- | --- | --- |
| Password, TOTP, AAL2 | Existing real disposable GoTrue CI: enrollment, fresh password login, TOTP challenge/verify, AAL1 denial, AAL2 admission, refresh retaining AAL2 | Not a new production login or real preview browser session |
| Session persistence/recovery | Real supabase-js with controlled fetch/localStorage; 8 transport and 12 application-resilience cases | HTTP failures simulated; production outage not induced |
| Logout | New invoice test uses real SDK with simulated logout HTTP; asserts credential deletion, SIGNED_OUT and null session; unchanged actual MFA provider removes invoice access | Does not prove server-wide revocation or a production browser logout |
| MFA UI/SQL | 18 real component tests with SDK boundary mocks; 38 PGlite tests with synthetic Auth schema | Not the complete live migration sequence; missing cohort migration is not covered as production parity |
| Cohort | Existing real rename scenario compares outside-cohort admin before/after activation; UI/SQL tests cover enforcement and recovery locks | No complete matrix of ordinary users, effective Amazon permissions and live Platform delegation under the missing strict-cohort migration |
| Amazon permissions | Existing owner/workspace/security assertions and unchanged permission code; SQL negative cases | No genuine Amazon-authorized user/data matrix or SP-API operation executed |
| Protected RPC/Edge | SQL definer/RLS negative tests; 8 Edge tests forwarding original bearer and denying failures; real disposable Edge denies unauthenticated and recovery-locked AAL1 | Mocks for most RPC boundary checks; not every production RPC/Edge happy path |
| Platform bridge | Explicit SQL decision and actor binding tests; deployed source exactly matches main; real Edge rejects absent token | No valid trusted Platform token used for delegation/system:plan-sync; no live plan changes |
| Workers/cron | Static checks preserve machine-only credentials; production read-only health observation | Successful cron dispatch is not proof of every worker/provider outcome |
| Invoice + Gmail | Synthetic valid/duplicate/mismatch/service/unit/overflow/failure scenarios with actual PostgREST/Postgres in remote CI | Reader, Auth, Storage and Gmail mocked; integration stubs bypass actual MFA/RLS, so this is not an invoice write under real cohort enforcement |

The real MFA CI script has 11 named gates including Vault, recovery quorum, ownership isolation,
factor revocation and two Edge denial paths. Its cleanup signs out local users but does not assert
server-wide logout; this is why the invoice-specific SDK/provider checks were added separately.
No MFA implementation/test/workflow file was edited for this audit.

Production read-only observations: enabled pilot with one cohort member; 10 active cron jobs;
21 successful cron runs in the initial 30-minute window; zero held leases and 9 queued Amazon
jobs at observation. A later pre-cycle observation still showed 9 queued jobs and 10 successful
cron runs over 15 minutes. No test job was enqueued or manually executed. Do not claim queue
drain from these snapshots; verify the next scheduled cycle before release.

## Prepared release phases: DO NOT EXECUTE

1. Obtain authorized Vercel production metadata; record exact alias, immutable deployment and
   commit. Verify it includes the accepted MFA frontend. Abort on an unknown or mismatched ref.
2. Have the MFA owner reconcile the missing strict-cohort migration in its own scope. Recheck
   schema_migrations, checked-in SQL, guard integrity and source parity without changing the pilot.
3. Refresh main and PR refs. Rehearse their three-way merge, require no conflicts and byte-identical
   protected trees. Do not reset/rebase main or promote the standalone stale invoice branch.
4. After explicit merge approval, integrate by a non-destructive merge preserving current main.
   Run the five workflows on that exact combined result, including real disposable Auth/Vault.
5. Before any publish, drain existing Gmail batches; confirm no new migrations or Edge changes.
   Confirm preview uses an isolated database before any test write. Retain current deployment
   evidence, but do not select an older deployment as a global rollback target.
6. After separate deploy approval, publish the tested combined commit. Observe password/TOTP,
   AAL2, reload/refresh/logout/recovery, cohort inclusion/exclusion and Platform read access.
   Sensitive tests remain isolated; real production acceptance uses authorized legitimate users.
7. In isolated preview verify synthetic PDF, valid invoice, duplicate/mismatch review, persistence,
   error messages, Gmail mock flow and visual layout. Never seed fictitious production invoices.
8. Read worker leases/queue/cron and approved telemetry: unexpected MFA_REQUIRED outside cohort,
   Auth 5xx, security-check availability, invoice/Gmail errors and cost/history writes. No producer
   restarts, no security bypass, no credential extraction, no plan or carrier action for a test.
9. Stop on regression. Prepare the invoice-only rollback below; require approval before publishing.

## Invoice-only rollback rehearsal

The runtime diff between pinned main and the combined rehearsal tree contains only invoice
source modules. Applying its reverse to an isolated copy succeeded. All **503** main source,
Edge and migration files matched pinned main byte-for-byte afterward, with no extra source
files. The restored application build was run independently. This is a local rehearsal, not a
deployment rollback and not a resolution of the missing main migration.

For a future release, calculate the runtime diff between its actual first parent and merged
invoice commit. Review the allowlist (invoice modules plus the invoice-only repository/types
changes). Apply that inverse on a new rollback candidate based on the THEN-current main,
preserving intervening changes. If it conflicts or touches an auth/MFA/RLS/Edge/migration path,
STOP for review; do not force it. A whole merge revert is allowed only after checking its exact
first-parent diff preserves subsequent security work; never use reset or an old deployment alias.
Verify protected-tree hashes, types/build, invoice regression and the five workflows before
approval of that rollback candidate. Tests/docs can be reverted alongside their exact invoice
diff where appropriate; no SQL rollback, MFA settings change, user/session revocation or data
delete belongs to this operation. Existing pending invoices/JSON metadata remain and require
manual review; reversing code does not undo already-written costs or other records.

## Outstanding external gates

All 82 fixture records and added operational examples are synthetic, and the old four commits
are absent from current ancestry. Old objects remain addressable by SHA on GitHub: server/PR
reference/cache removal requires GitHub Support; no unsafe global history rewrite was attempted.
Vercel preview is Ready but official access remains 403; no protection was disabled. Its database
target and browser flows remain unverified. The connection cannot read main branch-protection
rules either; visible workflows are verified without certifying the administrative rule list.

Recommendation: BLOCKED pending production commit certification, MFA migration parity,
historical-object purge and authorized functional preview validation. No merge/deploy authorized.
