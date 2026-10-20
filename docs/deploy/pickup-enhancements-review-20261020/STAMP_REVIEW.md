# Company stamp review

All stamp images and company details in this folder are synthetic review fixtures. The rectangular stamp uses a blue yin-yang, sample ZENVIA text, fictitious CIF and sample address. No real uploaded company stamp was provided.

Reproduce with `SHIPPING_CHROMIUM_PACKAGE=1 node scripts/company-stamp-review.mjs` (requires existing Playwright, esbuild, @sparticuz/chromium and Python PyMuPDF). Alternatively omit the environment variable when Playwright Chromium is installed.

The harness renders the actual `SettingsPage`, production stylesheets, actual stamp image processor and actual pickup PDF renderer. Only its service/context boundaries are simulated; all network requests are blocked. It verifies separate logo/stamp controls, supported upload types and removal. It does not validate a live upload or production Storage access.

- `stamp-synthetic-scanned.png`: raw blue ink, white margins and grey scanner border.
- `stamp-synthetic-processed.png`: actual processed output, cropped with paper/border removed and transparency retained.
- `settings-general-{desktop,mobile}.png`: full General UI.
- `settings-stamp-{desktop,mobile}.png`: separate company stamp controls and preview.
- `settings-stamp-removed-{desktop,mobile}.png`: blank stamp after removal, separate logo control retained.
- `pickup-synthetic-stamp.pdf` / `.png`: real PDF and MuPDF render showing proportional sender stamp and blank driver box.

Security regression tests execute the migration and rollback in PGlite. They include legacy permissive sales storage policies and prove a non-admin cannot insert, update, delete a stamp, or rename a logo into a stamp. Existing logo permissions remain governed by their existing policies. Member owner resolution is covered both with an existing branding row and with no branding/fiscal row, using the RLS-protected `app_users.data_owner_id` record.

No production deployment, database mutation or Storage upload was performed.
