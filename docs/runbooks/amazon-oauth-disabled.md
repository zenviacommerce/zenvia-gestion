# Amazon OAuth: preparation with activation disabled

This branch prepares EU Website Authorization for `public_v1`. It does not authorize activation, deployment, secret changes, Amazon live calls, publishing an application, jobs or schema changes on a remote database. Keep `AMAZON_PUBLIC_OAUTH_ENABLED` absent or `false`. Only literal `true` with complete valid configuration enables the capability, start and callback. The manual private connection remains available.

## Mandatory merge and deployment gates

The reader preserves reconciliation's account-scoped temporary `AMAZON_LEGACY_FALLBACK_ACCOUNT_ID` exception for the persisted private integration `4e55e0f5-9388-467c-b35c-a86dd4a7b383`. Own tokens win; public never uses this exception, and owner/account/seller checks still apply. Do not widen or accidentally remove it during a future merge. Moving the current token to Vault remains a separate later task and is not a prerequisite for implementing OAuth or MFA. Before a future bundle rollout, verify named private credentials match the existing app and preserve the exception until the separately approved migration is complete.

Complete reconciliation, PII removal and MFA prerequisites in their approved order. Verify the app-aware readers, transactional writers, SQL ACLs and local PostgreSQL 17/Vault/concurrency tests before any deployment. A missing local database result is a release blocker, not an implied pass. No public credentials are needed for mocked tests.

## Backend configuration

| Name | Requirement |
| --- | --- |
| `AMAZON_PUBLIC_OAUTH_ENABLED` | Absent or `false` for this delivery; only exact `true` enables future use. |
| `AMAZON_PUBLIC_APPLICATION_ID` | SP-API public application ID; different from LWA client ID. |
| `AMAZON_PUBLIC_OAUTH_REDIRECT_URI` | Exact registered HTTPS callback on the functions origin, `/functions/v1/amazon-oauth-callback`. |
| `AMAZON_PUBLIC_OAUTH_UI_ORIGIN` | Exact approved HTTPS UI origin, no request-controlled return destination. |
| `AMAZON_PUBLIC_OAUTH_MODE` | Explicit `draft` (beta) or `published`. |
| `AMAZON_OAUTH_STATE_SIGNING_KEY` | Dedicated signing secret; never LWA client secret. |
| `AMAZON_SPAPI_PUBLIC_V1_CLIENT_ID`, `AMAZON_SPAPI_PUBLIC_V1_CLIENT_SECRET` | Complete public LWA pair, backend only. |
| `AMAZON_SPAPI_PRIVATE_V1_CLIENT_ID`, `AMAZON_SPAPI_PRIVATE_V1_CLIENT_SECRET` | Existing private pair; preserve identity and own refresh tokens. |

No client secrets belong in VITE variables, frontend responses, logs, telemetry or chat. Register the UI log-in URI at the approved origin with path `/amazon/oauth/login`. The inline first-head bootstrap captures only callback URI, Amazon state and seller in memory, then removes the complete query and fragment before app modules and Auth initialization. Reloading loses the continuation and requires a new authorization. The UI does not exchange codes or choose app/workspace from an Amazon URL. It validates a returned launch URL against the current tenant backend origin and exact start path, then navigates top-level.

Consent is fixed to `https://sellercentral-europe.amazon.com/apps/authorize/consent`. Continuation is restricted by the backend to the exact public application's EU confirmation path. Final UI outcomes are only `connected`, `failed`, `unavailable`; connected means authorization committed and onboarding remains to complete, not that synchronization succeeded.

## Local packaging and verification

CLI inspection performed with Supabase CLI 2.121.0: `supabase init --help`, `supabase functions deploy --help`. Local config was generated with `supabase init --yes`, without linking a remote project. Do not run deploy or db push as part of this work. The CLI help lists `--project-ref`, `--no-verify-jwt`, `--use-api`, `--import-map`, `--prune`, `--jobs`; their existence does not authorize using them.

`supabase/config.toml` declares `verify_jwt = false` for the callback, which cannot receive a Supabase JWT. Start also needs this gateway exception because its top-level GET carries a short opaque ticket, not a session JWT. Gateway settings apply per function, not per HTTP method. Start POST must independently verify Supabase Bearer with Auth, exact Origin and current user/workspace permissions; GET accepts only a signed-state-bound unexpired one-use ticket. Capability is an authenticated integration-accounts action. Do not relax JWT checking on other functions.

Run offline handler/state/UI suites with LWA fetch mocks that deny unexpected network calls. Run the app-aware reader suites and `npm run build` and `npm test`. SQL and concurrency tests require a disposable loopback PostgreSQL 17 database with actual Vault; never use production credentials. Record actual results separately, and do not present unavailable database tests as successful.

## Required HTTPS browser and ingress checks before activation

In a dedicated approved local HTTPS or preview environment, exercise the real top-level sequence with Amazon simulated: authenticated POST, ticket navigation, secure cookie, simulated consent, callback. Verify cookie name `__Host-zenvia-amazon-oauth`, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=600. Verify that another browser with the same valid state and no bound cookie cannot exchange; a new attempt cancels the previous browser attempt; expired/replayed/mixed tickets fail.

Inspect ingress, CDN, proxy, function, analytics and error-reporting logs before activation. Exclude or redact sensitive query strings on login/start/callback before collection, including Amazon code/state, ticket, seller and browser cookie. Restrict access and retention. Browser history stripping and sanitized application errors do not sanitize ingress requests already received. Verify no third-party analytics/resources on the login entry; the current HTML includes no analytics and sets no-referrer before resources. If the functions origin cannot support the required secure host cookie or ingress redaction, leave disabled and use an approved dedicated backend origin. Do not weaken cookie binding.

## Attempts, failures and rollback

State lives ten minutes; a ticket lives thirty seconds. The Amazon code's five-minute lifetime is separate. Each attempt is claimed once (`pending` to `exchanging`); failed, complete, expired or ambiguous attempts cannot replay. Timeouts/lost responses require a new authorization, never an automatic second token exchange. Failed/expired reservations release quota. Later authorized maintenance may invoke bounded `integration_amazon_oauth_cleanup` batches (default 100, maximum 1000); no scheduler is introduced here.

Before future schema application, capture migration names, schema, `pg_get_functiondef`, owner and ACL for the snapshot/manual/OAuth RPCs, function bundle versions and account-to-app/version metadata, without secrets. Test rollback against disposable PostgreSQL 17/Vault with private and public synthetic accounts. Keep a release record with the exact compatible reader bundle.

To stop new authorizations, set the flag off in a separately authorized operation: start and callback fail closed, and previous connections stay intact. Keep successful public authorizations, IDs, Vault secrets, seller registry, versions and schema. Reverting UI/start/callback is compatible only while retaining a reader that understands both apps. Never relabel a public token as private, delete public tokens/tables to simplify rollback, return to a monolithic reader, or revoke Amazon authorizations merely to test rollback. Seller ownership conflicts are blocked generically; there is no automatic transfer or `confirm=true` override.

## MFA integration activation blocker

Do not enable OAuth after the MFA branch is integrated until the combined security path is implemented and reviewed. The current `oauth-auth.ts` calls Auth directly and does not invoke the MFA branch's trusted human guard. Attempts also do not bind the initiating Auth session/factor/recent verification, and the service-role callback claim/commit do not revalidate recovery or the live MFA/session state. The independent branches are not ready for combined activation.

Before enabling the flag, route start through the trusted human/MFA authorization RPC, bind the validated principal/session and required assurance to the attempt, and revalidate current principal, session, factor/recent verification and recovery status at both claim and commit. Test AAL1/recovery-only starts, recovery or revocation after start, stale/replaced sessions and changed factors: zero exchange or credential writes as appropriate. A passing OAuth mock or frontend MFA screen is not evidence that these checks exist. This packaging follow-up adds no substitute guard and makes no MFA integration claim.
