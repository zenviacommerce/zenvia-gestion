import importlib.util
from pathlib import Path
import unittest
from lxml import etree

spec = importlib.util.spec_from_file_location('validator', Path(__file__).with_name('verify-verifactu-xml.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class OfficialXsdTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validator = module.schema()
        cls.source = Path('artifacts/verifactu-xml/F1-ordinary.xml').read_bytes()

    def test_generated_invoice_valid(self):
        module.validate(self.source, self.validator)

    def test_missing_required_hash_invalid(self):
        root = etree.fromstring(self.source)
        element = root.find('.//{*}RegistroAlta/{*}Huella')
        element.getparent().remove(element)
        with self.assertRaises(etree.DocumentInvalid):
            module.validate(etree.tostring(root), self.validator)

    def test_invalid_kind_and_wrong_element_order_invalid(self):
        for old, new in [(b'<sf:TipoFactura>F1</sf:TipoFactura>', b'<sf:TipoFactura>X1</sf:TipoFactura>'),
                         (b'<sf:IDVersion>1.0</sf:IDVersion>', b'<sf:FechaOperacion>24-10-2026</sf:FechaOperacion>')]:
            with self.assertRaises(etree.DocumentInvalid):
                module.validate(self.source.replace(old,new), self.validator)

    def test_rejects_entities_and_doctype(self):
        hostile = b'<!DOCTYPE a [<!ENTITY external SYSTEM "file:///definitely-not-read">]><a>&external;</a>'
        with self.assertRaises(ValueError):
            module.validate(hostile,self.validator)

if __name__ == '__main__':
    unittest.main()
