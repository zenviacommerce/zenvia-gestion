import { supabase } from './supabase';

export async function createRectifyingInvoice(originalInvoiceId:string){
  const year=new Date().getFullYear();
  const {data:series,error:seriesError}=await supabase
    .from('sales_invoice_series')
    .select('id')
    .eq('kind','rectifying')
    .eq('year',year)
    .eq('active',true)
    .limit(1);
  if(seriesError)throw seriesError;
  if(!series?.length){
    const {error:createError}=await supabase.from('sales_invoice_series').insert({
      code:'R',name:`Rectificativas ${year}`,kind:'rectifying',year,prefix:`R-${year}-`,next_number:1,padding:4,
    });
    if(createError&&createError.code!=='23505')throw createError;
  }
  const {data,error}=await supabase.rpc('create_rectifying_invoice',{p_original_id:originalInvoiceId});
  if(error)throw error;
  return data as string;
}


export type RectificationType='R1'|'R2'|'R3'|'R4'|'R5';
export type RectificationMode='S'|'I';
export const rectificationTypes=[
 {value:'R1',label:'R1 · Error de derecho y art. 80.Uno, Dos y Seis',description:'Error fundado de derecho; devoluciones, descuentos posteriores, resolución de operaciones y otros supuestos de los apartados indicados.'},
 {value:'R2',label:'R2 · Concurso de acreedores',description:'Modificación de la base imponible por concurso del destinatario (art. 80.Tres).'},
 {value:'R3',label:'R3 · Crédito incobrable',description:'Modificación de la base imponible por impago que cumple los requisitos del art. 80.Cuatro.'},
 {value:'R4',label:'R4 · Otras causas',description:'Otras rectificaciones: por ejemplo, errores en datos no monetarios u otras causas no incluidas en R1–R3.'},
 {value:'R5',label:'R5 · Factura simplificada',description:'Rectificación de una factura simplificada, cualquiera que sea la causa.'},
] as const;
export async function createSalesInvoiceCorrection(originalId:string,input:{type:RectificationType;mode:RectificationMode;reason:string}){
 if(!rectificationTypes.some(t=>t.value===input.type)||!['S','I'].includes(input.mode)||input.reason.trim().length<5)throw new Error('Selecciona tipo, modalidad y un motivo de al menos 5 caracteres.');
 const {ensureSalesSeries}=await import('./sales');await ensureSalesSeries(Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Madrid',year:'numeric'}).format(new Date())));
 const {data,error}=await supabase.rpc('create_sales_invoice_correction',{p_original_id:originalId,p_type:input.type,p_mode:input.mode,p_reason:input.reason.trim()});if(error)throw error;return data as string;
}
export async function cancelSalesInvoice(id:string,category:'nonexistent'|'duplicate',reason:string){
 if(!['nonexistent','duplicate'].includes(category)||reason.trim().length<5)throw new Error('Indica el supuesto y el motivo de anulación.');
 const {error}=await supabase.rpc('verifactu_cancel_sales_document',{p_document_id:id,p_document_kind:'invoice',p_reason:`${category==='nonexistent'?'Operación inexistente':'Emisión duplicada'}: ${reason.trim()}`});if(error)throw error;
}

export function correctionErrorMessage(error:unknown,fallback='No se pudo completar la corrección.'){
 const raw=error instanceof Error?error.message:typeof error==='object'&&error&&'message'in error?String(error.message):typeof error==='string'?error:'';
 const messages:Record<string,string>={
  VF_FISCAL_IMMUTABLE:'Las facturas emitidas no se pueden editar, borrar ni reabrir. Crea una rectificativa o registra una anulación cuando proceda.',
  VF_CORRECTION_TARGET_SUPERSEDED:'Esta factura ya tiene una corrección incompatible con otra sustitución. Abre la última rectificativa emitida desde los documentos vinculados y corrígela.',
  VF_ACTIVE_CORRECTIONS:'Hay rectificativas emitidas vinculadas. Revísalas antes de anular la factura original.',
  VF_RECTIFIED_DOCUMENT_INVALID:'La original no está disponible para esta corrección o está anulada. Actualiza la lista y revisa sus documentos vinculados.',
  VF_DOCUMENT_CLASSIFICATION_INVALID:'Revisa el tipo R1–R5 y la modalidad de rectificación. R5 corresponde a facturas simplificadas.',
  VF_RECTIFICATION_REASON_REQUIRED:'Indica un motivo de rectificación de entre 5 y 1.000 caracteres.',
  VF_RECTIFICATION_SNAPSHOT_INVALID:'La referencia de la original no coincide. Conserva el borrador y revisa la vinculación antes de emitir.',
  VF_CANCELLATION_CONFLICT:'Ya existe una anulación registrada con otro motivo. Actualiza la lista; no se ha creado otra anulación.',
  VF_ISSUE_DATE_BEFORE_PREVIOUS:'La fecha de emisión no puede ser anterior a la última factura de esta serie.',
 };
 return Object.entries(messages).find(([code])=>raw.includes(code))?.[1]||raw||fallback;
}
