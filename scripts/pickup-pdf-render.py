"""Render the actual offline fixture PDFs with MuPDF (no host Base14 substitution)."""
import json
from pathlib import Path
import fitz

folder = Path('docs/deploy/pickup-review-20261020')
sample = fitz.open(folder / 'pdf-manifest-sample.pdf')
for stale in folder.glob('pdf-manifest-page-*.png'):
    stale.unlink()
for index, page in enumerate(sample):
    page.get_pixmap(matrix=fitz.Matrix(1.85, 1.85)).save(folder / f'pdf-manifest-page-{index + 1}.png')
flow = fitz.open(folder / 'flow-desktop.pdf')
for index, name in [(0, 'first'), (len(flow) - 1, 'signatures')]:
    flow[index].get_pixmap(matrix=fitz.Matrix(1.85, 1.85)).save(folder / f'pdf-flow-{name}.png')
print(json.dumps({'samplePages': len(sample), 'flowPages': len(flow)}))
