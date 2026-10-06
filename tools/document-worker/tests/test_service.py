"""Actual HTTP/SQLite lifecycle against a simulated Ollama, without external providers."""
import base64,json,os,pathlib,socket,subprocess,sys,tempfile,threading,time,unittest,urllib.request,urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ROOT=pathlib.Path(__file__).parents[1]
class Ollama(BaseHTTPRequestHandler):
 calls=0
 def log_message(self,*args):pass
 def do_GET(self):self.reply({'models':[{'name':'fixture-model'}]})
 def do_POST(self):
  payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  assert payload['model']=='fixture-model';assert payload['stream']==False
  Ollama.calls+=1
  self.reply({'message':{'content':json.dumps({'candidates':[{'invoiceNumber':'F-1'},{'invoiceNumber':'A-2','documentKind':'credit_note'}]})}})
 def reply(self,payload):
  data=json.dumps(payload).encode();self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
class ServiceTest(unittest.TestCase):
 def test_durable_result_authentication_and_duplicate_submission(self):
  mock=ThreadingHTTPServer(('127.0.0.1',0),Ollama);threading.Thread(target=mock.serve_forever,daemon=True).start()
  with tempfile.TemporaryDirectory() as directory:
   with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
   env={**os.environ,'DOCUMENT_WORKER_PORT':str(port),'DOCUMENT_WORKER_SECRET':'fixture-secret-'+'x'*32,'DOCUMENT_WORKER_DATA_DIR':directory,'OLLAMA_BASE_URL':f'http://127.0.0.1:{mock.server_port}','OLLAMA_MODEL':'fixture-model'}
   def start():
    process=subprocess.Popen([sys.executable,str(ROOT/'app.py')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    for _ in range(100):
     try:request('/health');return process
     except (OSError,urllib.error.URLError):time.sleep(.03)
    process.terminate();raise AssertionError('service failed to start')
   def request(path,body=None,auth=True):
    headers={'Authorization':'Bearer '+env['DOCUMENT_WORKER_SECRET']} if auth else {}
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    with urllib.request.urlopen(req,timeout=5) as response:return json.load(response)
   process=start()
   try:
    with self.assertRaises(urllib.error.HTTPError) as denied:request('/health',auth=False)
    self.assertEqual(denied.exception.code,401)
    body={'analysisId':'a'*64,'kind':'transport_tariff','sources':[{'name':'tarifa.csv','data':base64.b64encode(b'Zona;Peso;Precio\nES;1;3,50').decode()}]}
    request('/analyze',body)
    for _ in range(100):
     result=request('/analyses/'+'a'*64)
     if result['status']=='completed':break
     time.sleep(.03)
    self.assertEqual(result['status'],'completed');self.assertEqual(len(result['result']['candidates']),2)
    count=Ollama.calls;request('/analyze',body);time.sleep(.1);self.assertEqual(Ollama.calls,count)
    process.terminate();process.wait(timeout=5);process.stderr.close();process=start()
    self.assertEqual(request('/analyses/'+'a'*64)['result'],result['result']);self.assertTrue(request('/health')['ok'])
   finally:process.terminate();process.wait(timeout=5);process.stderr.close()
  mock.shutdown();mock.server_close()
if __name__=='__main__':unittest.main()
