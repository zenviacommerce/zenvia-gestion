# PR240 visual review

Actual LabelModal from source c99c866f, production CSS, synthetic data, all external requests blocked. Five states, desktop (1440 viewport width) and mobile (390); viewport height expanded to capture full modal/footer. No real label operations. Direct-contract state is an explicit simulated post-filter result, not proof of a backend deployment.

Reproduce:

```bash
npm install --no-save --package-lock=false playwright@1.58.2 @sparticuz/chromium@153.0.0
SHIPPING_CHROMIUM_PACKAGE=1 node scripts/shipping-visual-screenshots.mjs
```

Playwright Chromium download returned truncated ZIP; pinned npm Chromium fallback used successfully. Retry fixture recovery asserted. No production source change needed (test-bundle-only export transform).
