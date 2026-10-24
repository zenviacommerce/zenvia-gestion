"""Offline contract checks only; requires lxml. Never sends SOAP or creates invoices."""
from pathlib import Path
import hashlib
import json
from lxml import etree

ROOT = Path(__file__).resolve().parent
CONTRACTS = ROOT / 'contracts'

class LocalContracts(etree.Resolver):
    def resolve(self, url, public_id, context):
        candidate = CONTRACTS / url.rsplit('/', 1)[-1]
        if not candidate.is_file():
            raise ValueError('Unpinned schema import: ' + url)
        return self.resolve_filename(str(candidate), context)

manifest = json.loads((CONTRACTS / 'manifest.json').read_text())
for entry in manifest['files']:
    data = (CONTRACTS / entry['file']).read_bytes()
    assert len(data) == entry['bytes'], entry['file']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['file']

parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
parser.resolvers.add(LocalContracts())
schemas = sorted(CONTRACTS.glob('*.xsd'))
for schema in schemas:
    etree.XMLSchema(etree.parse(str(schema), parser))
etree.parse(str(CONTRACTS / 'SistemaFacturacion.wsdl'), parser)

vectors = json.loads((ROOT / 'hash-vectors.json').read_text())['vectors']
for vector in vectors:
    actual = hashlib.sha256(vector['canonical'].encode('utf-8')).hexdigest().upper()
    assert actual == vector['sha256'], vector['case']

print(f"PASS: {len(manifest['files'])} pinned files, {len(schemas)} offline XSD compilations, {len(vectors)} official SHA-256 vectors")
print('Not yet validated: generated invoice XML, fiscal serializer, AEAT transport or real certificate')
