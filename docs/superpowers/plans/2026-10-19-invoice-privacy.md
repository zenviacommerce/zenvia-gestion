# Invoice privacy and release readiness

Goal: replace all branch-introduced operational examples with independent synthetic scenarios, remove their ancestry from PR #236 and report release gates honestly.

Scope: only invoice engine tests, fixtures, CI and release documentation. No MFA changes, no merge, no production action.

1. Verify local recovery bundle and that no remote branch/PR depends on the four commits.
2. Add a failing fixture privacy test. Generate 82 independent scenarios, preserve 28 review cases (14 high, 5 medium, 9 low), seven insertion failures, service exemptions, large quantities, units, duplicates and valid cases. Update tests and remove operational references from added documentation/comments.
3. Run Node, Vitest, types, build and PostgreSQL/PostgREST integration; require remote CI too.
4. Collapse the four implementation commits into one clean commit on their original main base. Audit its complete diff, parent and message. Publish with an explicit expected-head lease. Never modify another branch.
5. Verify remote tree/history, five workflows, mergeability and current main. Inspect protected preview only through official access; no production test writes. Record access failures and remaining gates.
6. Prepare phased activation/rollback and smoke instructions; do not execute them.

Review focus: privacy leaks in test names/messages; intermediate commit ancestry; lost regression coverage; unsafe preview database; schema and rollback assumptions.
