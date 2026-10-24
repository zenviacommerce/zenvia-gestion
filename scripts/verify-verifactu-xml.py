"""Offline XSD validation of generated submission bodies. No transport or credentials."""
from pathlib import Path
import hashlib
import json
import sys
from lxml import etree

CONTRACTS = Path(__file__).resolve().parents[1] / 'docs/deploy/20261023-verifactu-phase0/contracts'

class PinnedSchemas(etree.Resolver):
    def resolve(self, url, public_id, context):
        name = url.rsplit('/', 1)[-1]
        if name not in {'SuministroInformacion.xsd', 'SuministroLR.xsd', 'xmldsig-core-schema.xsd'}:
            raise ValueError('Unpinned schema import')
        return self.resolve_filename(str(CONTRACTS / name), context)

def schema():
    manifest = json.loads((CONTRACTS / 'manifest.json').read_text())
    for entry in manifest['files']:
        data = (CONTRACTS / entry['file']).read_bytes()
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('Official contract fingerprint mismatch: ' + entry['file'])
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    parser.resolvers.add(PinnedSchemas())
    return etree.XMLSchema(etree.parse(str(CONTRACTS / 'SuministroLR.xsd'), parser))

def validate(data: bytes, validator=None):
    if len(data) > 4 * 1024 * 1024:
        raise ValueError('XML payload limit')
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    root = etree.fromstring(data, parser)
    if root.getroottree().docinfo.doctype:
        raise ValueError('DOCTYPE is forbidden')
    (validator or schema()).assertValid(root)
    return root

if __name__ == '__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--stdin':
        try:
            validate(sys.stdin.buffer.read(4*1024*1024+1))
        except Exception:
            raise SystemExit('XML_VALIDATION_FAILED')
        raise SystemExit(0)
    files = sorted(Path(sys.argv[1] if len(sys.argv)>1 else 'artifacts/verifactu-xml').glob('*.xml'))
    if not files:
        raise SystemExit('No generated XML fixtures to validate')
    validator = schema()
    for file in files:
        validate(file.read_bytes(), validator)
    print(f'PASS: {len(files)} generated alta/anulacion XML submissions against pinned official XSD, offline')
    print('XSD validity is not AEAT business acceptance or a real submission')
