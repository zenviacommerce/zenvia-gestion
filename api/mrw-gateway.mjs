const MRW_PROD='https://sagec.mrw.es/MRWEnvio.asmx';
const MRW_TEST='https://sagec-test.mrw.es/MRWEnvio.asmx';
const ALLOWED=new Set(['GetPointsDB','TransmEnvio','GetEtiquetaEnvio','CancelarEnvio']);

function json(res,status,body){
  res.status(status).setHeader('content-type','application/json; charset=utf-8').send(JSON.stringify(body));
}
function clean(value){return String(value??'').trim()}

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Método no permitido.'});
  const expected=clean(process.env.MRW_GATEWAY_SECRET);
  const provided=clean(req.headers['x-zenvia-gateway-key']);
  if(!expected||provided!==expected)return json(res,401,{error:'No autorizado.'});

  const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  const environment=body.environment==='test'?'test':'production';
  const base=environment==='test'?MRW_TEST:MRW_PROD;

  try{
    let upstream;
    if(body.method==='GET'&&body.resource==='wsdl'){
      upstream=await fetch(base+'?WSDL',{headers:{
        Accept:'text/xml,application/xml',
        'User-Agent':'ZENVIA-MRW-Gateway/1.0',
      },redirect:'follow'});
    }else{
      const operation=clean(body.operation);
      if(!ALLOWED.has(operation))return json(res,400,{error:'Operación MRW no permitida.'});
      const soapVersion=body.soapVersion==='1.2'?'1.2':'1.1';
      const xml=clean(body.body);
      if(!xml)return json(res,400,{error:'Falta el cuerpo SOAP.'});
      const action='http://www.mrw.es/'+operation;
      const headers=soapVersion==='1.2'
        ?{'Content-Type':`application/soap+xml; charset=utf-8; action="${action}"`,Accept:'application/soap+xml,text/xml','User-Agent':'ZENVIA-MRW-Gateway/1.0'}
        :{'Content-Type':'text/xml; charset=utf-8','SOAPAction':`"${action}"`,Accept:'text/xml','User-Agent':'ZENVIA-MRW-Gateway/1.0'};
      upstream=await fetch(base,{method:'POST',headers,body:xml,redirect:'follow'});
    }

    const raw=Buffer.from(await upstream.arrayBuffer());
    return json(res,200,{
      status:upstream.status,
      contentType:upstream.headers.get('content-type')||'',
      bodyBase64:raw.toString('base64'),
    });
  }catch(error){
    return json(res,502,{error:'MRW no accesible desde el gateway: '+(error instanceof Error?error.message:'error desconocido')});
  }
}
