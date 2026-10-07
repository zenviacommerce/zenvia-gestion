# Gmail bulk import

The Gmail list uses the shared selection checkbox and bulk toolbar. Select-all
covers eligible attachments matching the current filters, across pagination.
Imported and ignored attachments are excluded. A captured batch is processed
sequentially through the existing Gmail importer, with isolated per-file errors.
Candidates requiring review are queued in the existing manual review modal;
closing it leaves their persisted review states available in the list.

Production review found three Gmail entries requiring review for a missing
invoice date. Two entries reference the same archived document and invoice
number, so existing hash and supplier/number deduplication remains essential.
The Google entry also contained the invalid alphabetic tax identifier
PLACEFACTURA. No production invoice rows or review metadata were changed.

Two extraction defects were reproduced and fixed: incorrectly escaped ISO date
validation rejected evidence-supported AI dates, and the labelled supplier tax
extractor accepted prose without any digits. Impossible calendar dates and
unsupported AI dates remain rejected. Original private PDFs were unavailable
through the connected read capabilities, so actual invoice dates were not
assigned or inferred from email receipt dates. Users can retry with the corrected
reader and review any remaining uncertain fields.

Validation: 802 tests passed, 0 failed; TypeScript/Vite production build passed.
Behavioral batch tests cover sequential processing, continuing after a failure,
retaining reviews, eligibility and duplicate selected IDs. The React/happy-dom
interface test covers select-all, imported-row disabling, batch invocation,
control locking, and advancing through two manual review forms.
