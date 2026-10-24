import QRCode from 'qrcode';

// Closed until real remittance/cutover is explicitly approved. Shadow is not live VERI*FACTU.
export const VERIFACTU_REAL_PDF_ENABLED=false;
export type QrInvoice={nif:string;number:string;date:string;total:string};
export function buildVerifactuQrUrl(invoice:QrInvoice,environment:'test'|'production'){
 const {nif,number,date,total}=invoice;
 if(!/^[A-Z0-9]{9}$/.test(nif)||!number||number.length>60||/[^\x20-\x7E]/.test(number)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||!/^[-]?\d{1,12}(\.\d{1,2})?$/.test(total))throw new Error('VF_QR_INVALID_FIELDS');
 if(!['test','production'].includes(environment))throw new Error('VF_QR_ENVIRONMENT_REQUIRED');
 const [year,month,day]=date.split('-');
 const query=new URLSearchParams({nif,numserie:number,fecha:`${day}-${month}-${year}`,importe:total});
 return `https://${environment==='test'?'prewww2.aeat.es':'www2.agenciatributaria.gob.es'}/wlpl/TIKE-CONT/ValidarQR?${query}`;
}
export function createVerifactuPreviewBlock(invoice:QrInvoice){
 const url=buildVerifactuQrUrl(invoice,'test');
 return {url,label:'PRUEBAS VERI*FACTU · NO REMITIDO · SIN VALIDEZ FISCAL',matrix:QRCode.create(url,{errorCorrectionLevel:'M'}).modules,sizeMm:35 as const,errorCorrectionLevel:'M' as const,syntheticPreview:true as const};
}
export type VerifactuPreviewBlock=ReturnType<typeof createVerifactuPreviewBlock>;
