import https from 'node:https';

const MRW_PROD='https://sagec.mrw.es/MRWEnvio.asmx';
const MRW_TEST='https://sagec-test.mrw.es/MRWEnvio.asmx';
const ALLOWED=new Set(['GetPointsDB','TransmEnvio','GetEtiquetaEnvio','CancelarEnvio']);

function json(res,status,body){
  res.status(status).setHeader('content-type','application/json; charset=utf-8').send(JSON.stringify(body));
}
function clean(value){return String(value??'').trim()}

function mrwRequest(url,{method='GET',headers={},body=''}={}){
  return new Promise((resolve,reject)=>{
    const target=new URL(url);
    const request=https.request({
      protocol:'https:',
      hostname:target.hostname,
      port:443,
      path:target.pathname+target.search,
      method,
      family:4,
      servername:target.hostname,
      minVersion:'TLSv1.2',
      headers:{
        Host:target.hostname,
        Connection:'close',
        'Accept-Encoding':'identity',
        ...headers,
      },
      agent:false,
      timeout:25000,
    },response=>{
      const chunks=[];
      response.on('data',chunk=>chunks.push(Buffer.from(chunk)));
      response.on('end',()=>resolve({
        status:Number(response.statusCode||0),
        contentType:String(response.headers['content-type']||''),
        body:Buffer.concat(chunks),
      }));
    });
    request.on('timeout',()=>request.destroy(new Error('timeout')));
    request.on('error',reject);
    if(body)request.write(body);
    request.end();
  });
}

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Método no permitido.'});
  const expected=clean(process.env.MRW_GATEWAY_SECRET);
  const provided=clean(req.headers['x-zenvia-gateway-key']);
  if(!expected)return json(res,500,{error:'MRW_GATEWAY_SECRET no está disponible en este deployment de Vercel. Guarda la variable y vuelve a desplegar.'});
  if(!provided)return json(res,401,{error:'Falta X-Zenvia-Gateway-Key en la petición.'});
  if(provided!==expected)return json(res,401,{error:'MRW_GATEWAY_SECRET no coincide entre Supabase y Vercel.'});

  let body;
  try{body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});}
  catch{return json(res,400,{error:'JSON no válido.'});}

  const environment=body.environment==='test'?'test':'production';
  const base=environment==='test'?MRW_TEST:MRW_PROD;

  try{
    let upstream;
    if(body.method==='GET'&&(body.resource==='wsdl'||body.resource==='operation')){
      const target=body.resource==='operation'?base+'?op=GetPointsDB':base+'?WSDL';
      upstream=await mrwRequest(target,{
        method:'GET',
        headers:{
          Accept:body.resource==='operation'?'text/html,application/xhtml+xml':'text/xml,application/xml',
          'User-Agent':'Mozilla/5.0 ZENVIA-MRW-Gateway/1.1',
        },
      });
    }else{
      const operation=clean(body.operation);
      if(!ALLOWED.has(operation))return json(res,400,{error:'Operación MRW no permitida.'});
      const soapVersion=body.soapVersion==='1.2'?'1.2':'1.1';
      const xml=clean(body.body);
      if(!xml)return json(res,400,{error:'Falta el cuerpo SOAP.'});
      const action='http://www.mrw.es/'+operation;
      const headers=soapVersion==='1.2'
        ?{'Content-Type':`application/soap+xml; charset=utf-8; action="${action}"`,Accept:'application/soap+xml,text/xml','User-Agent':'Mozilla/5.0 ZENVIA-MRW-Gateway/1.1'}
        :{'Content-Type':'text/xml; charset=utf-8','SOAPAction':`"${action}"`,Accept:'text/xml','User-Agent':'Mozilla/5.0 ZENVIA-MRW-Gateway/1.1'};
      headers['Content-Length']=String(Buffer.byteLength(xml,'utf8'));
      upstream=await mrwRequest(base,{method:'POST',headers,body:xml});
    }

    return json(res,200,{
      status:upstream.status,
      contentType:upstream.contentType,
      bodyBase64:upstream.body.toString('base64'),
      transport:'node-https-ipv4-http11',
    });
  }catch(error){
    return json(res,502,{error:'MRW no accesible desde el gateway: '+(error instanceof Error?error.message:'error desconocido')});
  }
}
