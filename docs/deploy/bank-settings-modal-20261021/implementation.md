# Bank Settings list/modal implementation handoff

2026-10-21. Worktree `/workspace/scratch/3d3f5cb6b87b/gestion-bank-settings-style`, native baseline `d2c3e00d5f3574a603a3267cfa13e9029610c456`.

Commit: `4540ab9` — Use shared Settings list and modal for bank accounts. Only the eight explicitly owned product/test/design files were committed. Product source is frozen at this commit. Root's untracked capture harness, fixture, deploy docs and tmp evidence remain unmodified by this implementer.

## Result

- General banking rests as shared Settings subsection/head + Add and configList/configRow summaries; no creation fields at rest or gray inset editor.
- Add/Edit uses shared FormModal, Settings label spans, responsive 3/2/1 grid, optional markers `(opcional)` inline, Cancel/Save and raw input hydration.
- Dialog semantics are attached locally to the actual visible `.formModal` surface. Focus starts in alias, Tab/Shift-Tab stays inside, Escape/backdrop/close discard only the bank draft, inert background is restored on cleanup, focus returns to opener or Add after list refresh, and saving disables controls/close. No shared UI package change.
- Independent bank persistence, successful close, retained error fields/retry, existing dirty company values, current default on reopen, and real ActionDialogHost removal confirmation are covered by integration tests.
- Valid IBAN is grouped only in managed list and shared selector. Selector choices still emit account IDs; service input is normalized. Invalid legacy text and historical snapshot rendering remain literal. Existing invoice/receipt/Shopify/series rules unchanged.
- Design-system rule documents list/modal collections, shared section/label/grid/list styles and distinct persistence boundaries; explicitly records five exceptions without converting them.

## Test-first evidence

1. `npm test -- tests/bank-accounts-general-ui.test.tsx` against baseline: expected RED, six new modal/resting-view tests failed, two existing navigation tests passed. Log `/tmp/bank-modal-red.log`.
2. First focused GREEN: bank General8 + existing document UI15 =23/23; `/tmp/bank-modal-green.log`.
3. Design-rule guard RED after correcting file URL test environment to cwd: missing documented contracts; `/tmp/bank-modal-rule-red.log`. Added rule, guard GREEN.
4. Edit-save focus fallback regression RED1 before fix; `/tmp/bank-modal-focus-return-red.log`; focused GREEN12/12 `/tmp/bank-modal-focused3.log`.
5. Root browser capture discovered zero-height outer semantic dialog wrapper. Added DOM regression asserting role on real FormModal, observed RED1 `/tmp/bank-modal-surface-red.log`; corrected local adapter; GREEN12/12 `/tmp/bank-modal-surface-green.log`.

## Final validation

- `npm test`: PASS64 files,322 tests, exit0 on corrected final source; `/tmp/bank-modal-final-vitest.log`.
- Workflow command `node --test $(find scripts -maxdepth 1 -name '*.test.mjs' ! -name 'mfa-real-integration.test.mjs' | sort)`: PASS1244/1244, exit0; `/tmp/bank-modal-full-node.log`. Ran before final semantics-only correction; final Settings/forms subset rerun below.
- `node --test scripts/settings-control-normalization.test.mjs scripts/settings-typography.test.mjs scripts/settings-general.test.mjs scripts/shared-form-controls.test.mjs scripts/shared-form-regression.test.mjs scripts/sales-settings.test.mjs scripts/supplier-settings.test.mjs scripts/order-shipping-settings.test.mjs scripts/integration-settings.test.mjs`: PASS48/48, exit0 on final source; `/tmp/bank-modal-final-contracts.log`.
- `npm run build`: PASS exit0, TypeScript + production Vite + iOS icon verification, final bundle `index-Duqr1krk.js`; `/tmp/bank-modal-final-build.log`.
- `git diff --check`: clean before commit. Build-generated tracked icon restored; untracked icon/tsbuildinfo produced by this build removed, no generated assets committed.
- React checklist reviewed: local component lifecycle, cleaned global listeners/inert state, controlled input state, ref-backed current close/busy handlers, shared primitives, no new dependency, stable IDs and no snapshot mutation.

## Limits / review handoff

Root owns real-browser captures, visual review, exact-head CI and release. No live database, remote financial, SQL, Auth/MFA, push/merge/deploy, or external actions were performed. Full Vitest includes offline mocked auth resilience and isolated PGlite SQL suites. Expected environment npm http-proxy warning, PDF legacy warning and mocked transient auth stderr occur; all suites passed. Build has existing large-chunk warning.

Please inspect shared selector peer typography and modal heading context in screenshots: modal lives within Settings subsection, so descendant heading styles deserve visual comparison. No unverified visual success is claimed here. Five non-bank fixed collections remain deliberate documented exceptions.

## Review correction — final frozen source

Supersedes the earlier source freeze: final commit `0304fe729da1bdf8d64aa339c987d46bf3c78f87`, tree `c7baf965e18bd9ea979333fc95d674072ff81b76`; parent commit `4540ab9dc6b33d719c38eadcec667863fe33b3bc`.

Root's actual Chromium computed-style regression (`/tmp/bank-settings-modal-input-review.log`) observed General input14px/400 versus modal14px/700. Narrow `.bankAccountModal .settingsField input` resets only value font weight to semantic normal400, retaining Settings label12px/800 and existing optional marker. Shared modal heading was also affected by its Settings ancestor (15px and top margin0): local header rule restores shared FormModal default heading font size via `revert` and its existing2px0 4px margins. No global package/style change.

Reviewer found successful save followed by list reload failure was obscured by reset clearing the error. Added integration regression in `/tmp/bank-modal-reload-red.log`, observed RED1/9 before fix. Split bank draft reset from explicit cancel error clearing: a committed save closes the editor, preserves list error+Actualizar cuentas, and retry reloads only. Test verifies one save call through retry and keeps dirty company values.

Final review-wave validation:
- `npm test -- tests/bank-accounts-general-ui.test.tsx tests/bank-accounts-ui.test.tsx tests/bank-account-display.test.tsx tests/settings-collection-pattern.test.ts`: PASS4files/28tests exit0; `/tmp/bank-modal-review-green.log`.
- `npm run build`: PASS exit0, bundle `index-C8NoqN-G.js`; `/tmp/bank-modal-review-build.log`. Existing large-chunk warning unchanged.
- `git diff --check`: clean. Commit includes only three owned source/test files. Build-generated public icon and tsbuildinfo again restored/removed.
- Full application322 and full offline Node1244 results above predate this review wave; root final-head CI owns fresh complete verification. No broad Node rerun requested for this correction.

Refrozen and ready for root Chromium computed-style GREEN and final visual captures/review. Remaining working tree entries are root-owned untracked capture/deploy/tmp files only.

## Inheritance correction — browser verification pending

Final CSS follow-up replaces direct input font-weight with regular weight on `.bankAccountModal .settingsField`. Root's Chromium check showed the direct input declaration was overridden by the higher-specificity Settings `font:inherit` shorthand, so commit0304 alone did not achieve input parity. Explicit Settings label spans remain800; the field context supplies regular weight for inherited input text, without !important or higher selector specificity. Header and async reload fixes remain unchanged.

`npm test -- tests/bank-accounts-general-ui.test.tsx tests/settings-collection-pattern.test.ts`: PASS2files/10tests, `/tmp/bank-modal-inheritance-tests.log`. `npm run build`: PASS exit0, bundle `index-6nbKQGOU.js`, `/tmp/bank-modal-inheritance-build.log`; standard chunk warning only. Diff check clean; generated icon/tsbuildinfo restored. Exact Chromium GREEN is pending root's tiny General capture; do not treat tests/build alone as computed-weight proof.

Root confirmed authoritative Chromium GREEN for corrected inherited typography at390 and1280: fresh add-account images were emitted only after the runtime assertion compared every bank input's computed fontSize/fontWeight/textTransform/letterSpacing with General's company input. Final follow-up commit `62883c382f7598aded4b0b59f1e14ada929e3e9a`, tree `bf50d456b213fea582f4f618e40d69a66d373bf6`. Source refrozen; root full matrix is running against this CSS and will verify source hashes against the commit. No further source changes planned.
