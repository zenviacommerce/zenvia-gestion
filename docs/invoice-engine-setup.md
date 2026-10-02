# InvoiceEngine (preview only)

All purchase/expense entry points use `InvoiceEngine`: uploads, camera, bulk files, Gmail attachments/HTML and structured subscription invoices. Vercel calls an authenticated self-hosted Ollama vision API. It never runs the model or exposes its credentials to the browser.

Configure **Preview** variables in Vercel:

- `INVOICE_ENGINE_MODEL_URL`: HTTPS base URL of your Ollama reverse proxy (e.g. `https://your-model-host.example/`). The API appends `api/chat`.
- `INVOICE_ENGINE_MODEL`: installed vision model tag; default `qwen2.5vl:7b`.
- `INVOICE_ENGINE_MODEL_TOKEN`: bearer token enforced by your reverse proxy. Keep Ollama's port private; the server must accept calls from Vercel.
- `INVOICE_ENGINE_TENANTS`: JSON object mapping allowed Supabase project URLs to their **publishable/anon** keys. Include only the isolated preview project for this preview. Never use a service-role key here.
- Existing `VITE_PLATFORM_SUPABASE_URL` / tenant routing must resolve the preview workspace to the isolated Supabase project. Never point preview tests at the production workspace.

On the self-hosted GPU server, install Ollama, pull the configured vision model and expose `/api/chat` through an HTTPS authenticated proxy. Allow a 240-second upstream timeout and the model's context window used by the endpoint (32768). GPU memory and latency must be measured with the actual invoices; a slow/unavailable model sends documents to review rather than creating fabricated records. No cloud-model fallback is enabled.

Apply the preserved `20261002170000_invoice_engine.sql` migration followed by `supabase/migrations/20261002190000_invoice_engine.sql` **only to the isolated preview project**. This creates RLS-protected import jobs, identities, correction examples, RPCs and a new private evidence bucket. It does not rewrite old invoices or change existing bucket/index/policy settings. Existing supplier/number uniqueness is preserved: a differing date/total with the same supplier/number requires review.

The application limits originals to 25 MiB and PDFs to 60 pages, analyzes at most three rasterized pages per request, and never substitutes a line-free invoice on failure. High-confidence fiscal-valid candidates save automatically through their entry flow. Review persists across page reloads. Review confirmation bypasses confidence gating, never arithmetic, VAT, fiscal identity or tenant checks. Historical/credit/foreign-currency purchases do not overwrite current base-currency purchase cost.

Run `node --test scripts/invoice-engine*.test.mjs`, `node --test scripts/*.test.mjs`, and `npm run build`.

Real vision accuracy and Gmail OAuth end-to-end checks require the user's actual configured model and isolated preview workspace. Fixture/model-stub tests verify orchestration and fiscal/persistence behavior, not real OCR accuracy. No production migration, model configuration, merge or production deploy is authorized by this PR.

Optional real vision fixture suite: set `INVOICE_ENGINE_VISION_TEST_URL` to your authenticated HTTPS Ollama proxy, plus `INVOICE_ENGINE_MODEL_TOKEN` and `INVOICE_ENGINE_MODEL`, then run `node --test scripts/invoice-engine-vision.test.mjs`. PDF fixture tests require Poppler (`pdftoppm`). With no test model URL, those eight tests are explicitly skipped. Fixtures include a wrinkled ticket image, one invoice across three pages, five invoices in one PDF, mixed IVA, credit, intracommunity/reverse charge, IRPF and an HTML email. Synthetic fixtures do not replace trials with your actual suppliers' documents.
