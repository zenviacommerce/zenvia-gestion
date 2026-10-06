import base64, importlib.util, unittest, pathlib
path=pathlib.Path(__file__).parents[1]/'documents.py'
spec=importlib.util.spec_from_file_location('documents',path)
api=importlib.util.module_from_spec(spec) if spec else None
if path.exists():spec.loader.exec_module(api)
class DocumentsTest(unittest.TestCase):
 def test_semicolon_csv_preserves_decimal_comma(self):
  self.assertTrue(hasattr(api,'read_document'))
  result=api.read_document({'name':'tarifa.csv','mimeType':'text/csv','data':base64.b64encode('Zona;Peso;Precio\nEspaña;0,890;3,50'.encode()).decode()})
  self.assertIn('0,890',result['text']);self.assertIn('3,50',result['text']);self.assertIn('España',result['text'])
 def test_unknown_format_does_not_silently_create_candidate(self):
  self.assertTrue(hasattr(api,'read_document'))
  with self.assertRaises(ValueError):api.read_document({'name':'x.exe','data':'eA=='})
 def test_model_result_requires_array_and_keeps_multiple_invoices(self):
  self.assertTrue(hasattr(api,'parse_model_result'))
  self.assertEqual(len(api.parse_model_result('{"candidates":[{"invoiceNumber":"1"},{"invoiceNumber":"2"}]}')['candidates']),2)
  with self.assertRaises(ValueError):api.parse_model_result('{"candidates":"bogus"}')
if __name__=='__main__':unittest.main()
