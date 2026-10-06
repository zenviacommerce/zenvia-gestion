"""Server-side document reading. No browser, no paid AI provider."""
import base64, csv, io, json, os, zipfile, xml.etree.ElementTree as ET
MAX_FILE_BYTES=20*1024*1024
MAX_PAGES=int(os.environ.get('DOCUMENT_MAX_PAGES','40'))
def read_document(source):
 data=base64.b64decode(source.get('data',''),validate=True)
 if not data or len(data)>MAX_FILE_BYTES:raise ValueError('El documento está vacío o supera 20 MB.')
 name=str(source.get('name','')).lower();mime=str(source.get('mimeType',''));text='';images=[]
 if name.endswith('.pdf') or mime=='application/pdf':
  import fitz
  with fitz.open(stream=data,filetype='pdf') as pdf:
   if pdf.is_encrypted:raise ValueError('El PDF está protegido. Desbloquéalo antes de importar.')
   if len(pdf)>MAX_PAGES:raise ValueError(f'El PDF supera {MAX_PAGES} páginas. Divide el documento.')
   for index,page in enumerate(pdf):
    text+=f'\n--- PÁGINA {index+1} ---\n'+page.get_text(sort=True)
    # Vision also reads scanned tables, letterheads and tax breakdowns.
    scale=min(1.5,1400/max(page.rect.width,page.rect.height))
    images.append(base64.b64encode(page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False).tobytes('png')).decode())
 elif name.endswith(('.jpg','.jpeg','.png','.webp')) or mime.startswith('image/'):
  import fitz
  with fitz.open(stream=data) as image:
   page=image[0];scale=min(1,1400/max(page.rect.width,page.rect.height))
   images=[base64.b64encode(page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False).tobytes('png')).decode()]
 elif name.endswith('.csv') or mime=='text/csv':
  try:raw=data.decode('utf-8-sig')
  except UnicodeDecodeError:raw=data.decode('cp1252')
  try:dialect=csv.Sniffer().sniff(raw[:8192],delimiters=';,\t')
  except csv.Error:dialect=csv.excel
  text='\n'.join(' | '.join(row) for row in csv.reader(io.StringIO(raw),dialect))
 elif name.endswith('.xlsx'):
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   if sum(i.file_size for i in z.infolist())>100*1024*1024:raise ValueError('La hoja de cálculo descomprimida es demasiado grande.')
   ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};strings=[]
   if 'xl/sharedStrings.xml' in z.namelist():strings=[''.join(node.itertext()) for node in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
   for sheet in sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')):
    text+='\n--- '+sheet+' ---\n'
    for row in ET.fromstring(z.read(sheet)).findall('.//s:row',ns):
     cells=[]
     for c in row.findall('s:c',ns):
      v=c.find('s:v',ns);value=v.text if v is not None and v.text else ''
      if c.get('t')=='s' and value.isdigit():value=strings[int(value)]
      elif c.get('t')=='inlineStr':value=''.join(c.find('s:is',ns).itertext())
      cells.append(c.get('r','')+'='+value)
     text+=' | '.join(cells)+'\n'
 else:raise ValueError('Formato no compatible: usa PDF, imagen, XLSX o CSV.')
 if len(text)>180000:raise ValueError('El texto del documento supera el límite de análisis. Divide el documento.')
 return {'text':text,'images':images}
def parse_model_result(raw):
 result=json.loads(raw)
 if not isinstance(result,dict) or not isinstance(result.get('candidates'),list) or not result['candidates'] or len(result['candidates'])>100:raise ValueError('El modelo no devolvió candidatos válidos.')
 if not all(isinstance(c,dict) for c in result['candidates']):raise ValueError('Candidato no válido.')
 return result
