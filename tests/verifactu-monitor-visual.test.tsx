import {it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {FormModal} from '@zenvia/ui';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {VerifactuIntegrityContent} from '../src/components/VerifactuIntegrityModal';
import type {VerifactuIntegrityReport} from '../src/services/verifactuMonitor';
vi.mock('../src/services/supabase',()=>({supabase:{rpc:vi.fn()}}));
const output=process.env.VF_NEXT_CAPTURE;
it.skipIf(!output)('exports actual monitor components with synthetic offline states',()=>{
 mkdirSync(output!,{recursive:true});
 const base:VerifactuIntegrityReport={checkedAt:'2026-10-24T21:22:05Z',mode:'shadow',status:'empty',recordCount:0,altaCount:0,cancellationCount:0,eventCount:1,issueCount:0,issues:[],issuesTruncated:false,days:[],recent:[],aeatConnected:false};
 const ok:VerifactuIntegrityReport={...base,status:'ok',recordCount:3,altaCount:2,cancellationCount:1,eventCount:5,days:[{day:'2026-10-24',altas:2,cancellations:1}],recent:[{id:'synthetic',invoiceId:'synthetic-invoice',sequence:3,kind:'anulacion',hash:'A'.repeat(64),generatedAt:base.checkedAt}]};
 for(const [name,state] of [['01-monitor-empty',base],['02-monitor-ok',ok],['03-monitor-broken',{...ok,status:'broken',issueCount:1,issues:[{code:'RECORD_DIGEST',recordId:'synthetic',sequence:3}]}],['04-monitor-error',null]] as const){
  const body=renderToStaticMarkup(<FormModal className="vfIntegrityModal" title="Integridad de la sombra" eyebrow="VERI*FACTU · SEGUIMIENTO" subtitle="DATOS SINTÉTICOS · verificación de solo lectura" onClose={()=>{}} actions={<><button className="secondary">Volver a comprobar</button><button className="primary">Cerrar</button></>}>{state?<VerifactuIntegrityContent report={state as VerifactuIntegrityReport}/>:<div className="errorBox" role="alert">No se pudo completar la verificación. El estado de la cadena es desconocido; vuelve a comprobarlo.</div>}</FormModal>);
  writeFileSync(`${output}/${name}.html`,`<!doctype html><html lang="es" data-visual-fixture="synthetic-offline"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name} · síntesis offline</title><link rel="stylesheet" href="../../20261024-verifactu-phase1/visual-fixture.css"><style>${readFileSync('src/components/VerifactuIntegrityModal.css','utf8')}</style></head><body>${body}</body></html>`);
 }
});
