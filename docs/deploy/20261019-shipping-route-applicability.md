# Quote route applicability follow-up — NOT published

User accepted PR240 and reported DHL Madrid-origin-only/Cainiao no-origin-coverage diagnostics classified as failed/retryable. Quotes already return per-carrier reasons; the collector treated every diagnostic as an error.

Classify existing diagnostics before rendering: route restrictions remain visible as No aplica a esta ruta, successful options remain ready and no Retry is offered for these exclusions. Empty applicable set becomes not_applicable. Timeout/HTTP5xx remain partial/error with Retry; permanent credentials/configuration errors remain visible without Retry. Mixed route+transient diagnostics retain both reasons and Retry for the provider.

No backend/SQL change required: existing Edge response includes the actual carrier/error messages. No deployment or merge authorized for this visible follow-up. Branch based on accepted main966a41; does not include PR237. Tests reproduce classification failure first and verify diagnostic visibility/Retry policy. Build/full suites/CI receipts to follow.

HTTP status is preserved on invocation errors, so opaque 503 bodies remain retryable; regression reproduced false Retry before the fix, now covered alongside mixed/permanent/route outcomes. Independent focused review found no blocking issue. Only frontend classification/rendering changes; no production/backend mutation.


Final gate: source5f2776e842a5592042368affde3c7935286ef4a5; all five workflows completed success. Local126Vitest/1098Node/build. PR242 remains draft and unpublished; no Edge/SQL change. User review required for visible follow-up. Receipts in 20261019-followup-ci-receipts.json.
