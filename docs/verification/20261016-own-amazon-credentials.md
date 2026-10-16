# Own Amazon credentials: deployment blocked

Preflight at 2026-10-16 06:09:16 UTC: the sole connected Amazon account has credential_source=environment, no secret and no own refresh token. Only presence booleans were inspected. Strict credentials would stop its jobs. No producers were paused and no function was deployed. A new window requires own stored credentials first.

The loader ignores global seller refresh tokens for every credential_source, including environment. Shared application client ID/secret remain supported. The legacy environment-only helper fails closed. Missing/blank own refresh tokens throw exactly `cuenta Amazon sin credenciales`.

Regression: six behavioral cases, four failing before the fix and six passing afterward; plus four tenant-isolation checks passing. Tests use synthetic secrets and no Amazon calls. The full suite still has the eight stale expectations addressed independently by PR #215.

Rollback: previous candidate config is at 9c2ea0c1d6ddeb31d84519560417e7e5786c74c2. Production rollback remains the exact per-function bundles under production-snapshot at sync/production-snapshot-20261015 commit 09c68337c1053dba4480e3916b537a907d9a793a. Restoring global fallback reintroduces the isolation risk and is not an operational workaround.
