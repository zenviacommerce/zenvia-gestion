# Compact pickup PDF review

Separate frontend-only deployment after completed tracking release #279. No database or provider changes. Synthetic shipments and sender fixture with repository logo; no buyer data. The existing saved sender/logo/stamp pipeline is preserved.

| Shipments | A4 pages | Signatures |
|---|---|---|
| 9 | 1 | Last shipment page |
| 25 | 1 | Last shipment page |
| 30 | 1 | Last shipment page |
| 60 | 2 | Last shipment page |

The compact header/table use 8–9 pt text and monospace tracking. Table header, report number and Page X of Y repeat. Signature boxes are 60 x 25 mm with aspect-preserved sender stamp. Company name wrapping dynamically shifts the address; the real-PDF regression reproduces the former overlap with and without a logo.

Validation: real PDF page/text/path assertions for all four counts, stamp placement/absent-damaged handling, all existing shipment identities/totals, no signature-only page, normal tracking stays on one line. Header wrapping regression observed red then green. Full CI must be green before merge. Rollback is a frontend redeploy of the preceding main #279 (9ea3be262856c01e30bce79f98c48c10cae7e9e1); it does not change tracking state.

PNG captures use the existing MuPDF pipeline (scripts/pickup-pdf-render.py approach) to avoid host Base14 font substitution in Poppler.
