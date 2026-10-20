# 2026-10-20 — Pilot browser acceptance and 48-hour watch

Owner confirms normal login requests TOTP, application works and reloading an existing AAL2 session does not request another code. Pilot accepted; scope remains single owner, no expansion.

Read-only SQL20Oct06:59:11UTC: enabledtrue,cohort count1,guard0; worker succeeded06:55:07.477UTC, no failed jobs in last hour. Subsequent07:10cycle produced successful jobs through07:10:48.265UTC. At07:17:07UTC:0liveleases,0running,0recentfailed,1eligiblequeued for next scheduled cycle. No worker/producer invocation forced and no cron changed.07:10:33UTC:0failedcron,37connections/90.

Resumed existing hourly watch automation6ad5d0575afc819188bbf4b395d5429c for48checks from20Oct10:00Europe/Madrid, bounded through22Oct10:00. Checks policy/cohort, integrity guard, worker/cron and last-hour Auth/MFA/pool/timeout errors; silent when normal, significant incidents/final summary only. Actual pilot regressions authorize emergency disable, verify and journal. No frontend/Edge/Auth configuration or cohort expansion under monitoring.

User separately authorizes PR#250 entity freshness fix after green CI; rollback captured before that publication: dpl_DLT8CGvp4zuFH7yQurn734LUYaS4/index-DqmjjHIX.js. It does not modify the MFA enforcement flag or SQL policy.
