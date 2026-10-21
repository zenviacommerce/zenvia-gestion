# Independent bank list/modal release review

Reviewed 2026-10-21 against product commit `4540ab9` (base `d2c3e00`). Read implementation brief, plan, implementation handoff, full product diff, final relevant sources and tests. Source/Git untouched. Existing root captures are uncommitted and being regenerated; this review does not certify their eventual manifest or final release SHA.

## Critical

None found.

## Important

1. **Successful save followed by failed reload silently loses the reload error.** `src/components/BusinessBankAccountsPanel.tsx:48,51,53,57`. `refresh()` catches the read failure and sets `error`, so `changed()` resolves. The save path then calls the newly changed `reset()`, which clears `error`. Consequently, a successfully created account can be absent from the stale/empty list while the dialog closes and a success toast appears, with no retry/warning. Before this change `reset()` did not clear errors. Preserve the reload warning outside the closed editor after the write succeeds, and test success of the save RPC followed by failure of the list request and successful list-only retry. Do not leave a new-account form ready to submit an already completed creation again.

2. **Bank input values do not match General typography.** Root independently measured Chromium at 390: General input 14px/400, bank modal input 14px/700, caused by inherited modal label weight. The after General add captures at 390/1280/1440 visibly corroborate bold bank values against normal-weight underlying General controls. This violates the explicit same-input-style requirement. Root already delegated the narrow CSS correction. Label spans themselves match the Settings contract. Root evidence: `/tmp/bank-settings-modal-input-review.log`.

## Minor

No additional actionable regression found. The local dialog adapter relies on the existing FormModal classes, but it is constrained to this editor and covered by a test asserting semantics on the actual surface; no shared-package expansion is warranted.

## Spec verdict

Substantially implemented, pending the two Important fixes. At rest the banking subsection uses the existing section/head, list/rows/badge/buttons and Add-only flow; creation fields are absent. Add/Edit use shared FormModal with named actual dialog surface, Settings label spans, three-column grid with wide spans and responsive collapse, optional annotations inline, Cancel and Save. Real removal confirmation is retained. Valid IBAN grouping affects only display in list/selector, normalized write behavior remains, and invalid legacy values and snapshots remain literal.

## Quality and behavioral evidence

- Reviewed local focus initialization, Tab wrapping, focus escape recovery, background inert restoration, Escape/backdrop/close handling, disabled controls and close protection during busy state. The first semantic-wrapper zero-height issue is fixed on this commit: role/name/tabIndex are attached to `.formModal`.
- Checked dirty-state integration: the existing independent-settings boundary prevents company dirty capture, and bank reset reports only its own dirty flag; General aggregates bank and company flags. Cancel/reopen uses fresh bank values; successful bank save does not replace company inputs.
- Checked defaults: reopening hydrates the current account list, default operations refresh the list; impossible clicks through an active editor overlay are no longer assumed. Shared selector default/manual selection, financial operations, service schema and historical snapshot logic are unchanged.
- Reviewed tests for add/edit/save, cancellation/focus restoration, real delete confirmation cancellation/acceptance, validation/service errors, busy state, company dirtiness, normalization, reopening after default changes, grouped labels selecting IDs and literal snapshots.
- Inspected supplied after captures for General add at 390/1280/1440, General populated at 390/1440, empty General at 390, removal confirmation at 390, invoice selector at 1440, receipt selector at 390 and Shopify series-default selector at 1440. Other than the input-weight mismatch, these representative surfaces show no overflow or obscured required actions. This is representative review, not an independent replay of the complete capture harness.
- Root/implementer report final Vitest 322/322 and production build passing, plus Node 1244/1244 before the semantics-only fix and scoped Node 48/48 after it. I did not rerun these unchanged suites. The lost reload warning is absent from existing mocked save/error coverage, because its loader always succeeds.
- The shared ActionDialogHost's baseline keyboard-focus limitations were observed but are unchanged and outside this patch; no global confirmation rewrite is requested.

## Release assessment

Hold this product SHA for the two narrow fixes. After scoped regression checks and re-review of the fix diff and typography evidence, it should be eligible for the user's authorized publication, subject to root's final exact-head CI, complete captures and release verification. No SQL/backend/Auth/MFA/dependency change or real financial operation is needed.

## Scoped re-review: 4540ab9..0304fe7

Reviewed the exact three-file correction diff and updated handoff. **Important 1 (lost reload error) is resolved.** `resetDraft()` now closes/clears only the bank draft and dirty flag, while explicit cancel `reset()` additionally clears error. Successful writes use `resetDraft()`, preserving the failed refresh message at list level; validation/write failures still retain the editor. The new integration test exercises write success, subsequent list-read rejection, closed dialog plus visible warning, list-only retry, exactly one save, and preserved pending company values. Supplied RED and 28-test GREEN logs were inspected. No further async defect introduced by this narrow change was found.

**Important 2 remains open.** Root's Chromium follow-up still computes input weight700 at `0304fe7`: the new input override loses to higher-specificity Settings `font:inherit`. Author is correcting the label inheritance; final SHA and real-browser GREEN are pending. The modal-heading rule is local and restores the shared heading's browser-default font size and existing margins without changing section headings.

Release remains held only for the typography fix plus root's final verification. No unchanged broad suite was rerun in this scoped review.

## Final scoped re-review: 62883c382f7598aded4b0b59f1e14ada929e3e9a

Reviewed final `4540ab9..62883c3` fix package, final after-manifest and regenerated General add PNGs at 390/1280/1440. Both Important findings are now **addressed**, with no new fix regression found.

- **Important 1: addressed.** Final source retains the previously reviewed `resetDraft()` separation and successful-write/failed-read test. Reload failure stays visible after the committed editor closes; list retry does not repeat the write. The final CSS-only commit does not alter this behavior.
- **Important 2: addressed.** The ineffective input override was replaced by `.bankAccountModal .settingsField{font-weight:normal}`. This corrects the inherited context used by Settings input rules while leaving bold label spans intact. Final Chromium manifest reports all four bank inputs equal to General at each width: 14px, weight400, normal letter spacing, no text transformation. All label spans equal General: 12px, weight800, uppercase, 0.54px tracking. Regenerated PNGs visually corroborate normal-weight input values, readable inline optional text and unobscured Cancel/Save actions. Desktop grid has three tracks; mobile has one. The local modal-heading restoration remains sound.

Manifest source SHA-256 values for the panel and bank CSS were independently compared with their exact `62883c3` Git contents and match. All delivered screenshot hashes were also checked against the manifest. Manifest covers27 scenarios and60 curated captures (105 raw captures validated before curation), with every capture-validation entry passing, no document overflow and no recorded browser errors. The browser evidence is explicitly offline/synthetic with blocked network; it does not claim production financial operations.

**Final spec/quality verdict: approved for release from this review.** No Critical, Important or additional Minor finding remains open for this branch. Proceed with the user's already authorized publication after root's final-head CI and normal deployment verification. Prior broad-suite counts remain historical evidence as documented above; final-head full remote CI has not been represented as completed by this reviewer. No source/Git modification or external operation was performed during review.
