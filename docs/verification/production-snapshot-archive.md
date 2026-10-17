# Historical production snapshot

Archived reference: `archive/production-snapshot-20261015`, commit `09c68337c1053dba4480e3916b537a907d9a793a`.

The original branch `sync/production-snapshot-20261015` is retained unchanged at the same commit. This snapshot describes production before the reconciliation and is a historical rollback source, not the current deployment candidate. Its per-function code is under `production-snapshot/<function>/<file>`.

Current production reconciled on 17 October 2026; main alignment PR #225. Fresh readback: all 84 files across all fourteen functions match main commit `0c1a5d66fd592f3a116c2805aaef185d4262f198`; preserved JWT flags. The old snapshot must not be deployed as an ordinary update. GitHub does not offer a per-branch archive switch; archive naming and this manifest mark it as historical without deleting or moving the original ref.
