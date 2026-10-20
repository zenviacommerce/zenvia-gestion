# 20 October — pickup report real logo evidence (NOT PUBLISHED)

PR251 is already live as index-D4U9zrKC.js. The owner pointed to a text-only fake logo in the review PDFs. Investigation shows the synthetic harness supplied pickupLogoFixture, a made-up text bitmap. The published runtime already imports the same loadCompanyBranding used by invoices, resolves company_branding.logo_path, uses authenticated company-assets Storage download, rasterizes through Image/canvas to PNG, and fits the result proportionally in the jsPDF header (max35x14mm). No runtime substitution of the configured logo was found or reproduced.

## Real source, without creating a report
Read only company_branding and the matching Storage object metadata: private bucket, image/webp,5418bytes. Opened General in the existing signed-in production session: actual graphic logo loaded at150x100, via the shared authenticated loader. Captured its exact normalized PNG from the rendered img (no JWT/token/cookie extraction). Page-asset authenticated export timed out; the DOM PNG is the explicit alternative, not a claim to possess the original WebP bytes. Restored the user's tab to Resumen; did not save settings or create a pickup report.

Corrected the test-only fixture to this real logo, regenerated PDF samples and desktop/mobile captures. Synthetic orders, company text, report number and dates retained; only the logo is real. Added a no-logo sample. This is an evidence/test correction: src/, migrations, Auth and Edge remain unchanged. No new frontend deployment is needed to make the existing loader use the configured logo.

## Automated verification
New Node integration tests execute the actual companyBranding and pickup PDF modules, mocking only Supabase transport and a browser DOM backed by the already-installed native canvas decoder. Tests assert business_settings/owner scoping, company-assets/path, equality of real logo RGBA pixels after PNG conversion, actual image embedding into jsPDF, stored WebP/SVG conversion, no-logo skipping Storage with company-name fallback, and Storage failure still downloading a PDF with saved sender text. WebP format test re-encodes the captured pixels for an offline fixture; it is not the original production WebP. No test credentials or live Storage endpoint required in CI.

4 new tests pass locally; existing PDF geometry/privacy tests pass. CI exact-head receipt recorded in the PR. Production remains index-D4U9zrKC.js. STOP before merging or publishing, per owner.

Review assets: [index](pickup-review-20261020/README.md), [real-logo PDF](pickup-review-20261020/pdf-manifest-sample.pdf), [no-logo PDF](pickup-review-20261020/pdf-no-logo-sample.pdf).
