/**
 * Motor común de integridad de facturas de gasto.
 *
 * Lo usan todos los canales que pasan por el importador común (subida manual, importación masiva,
 * Gmail, reprocesado de mantenimiento) y, como última barrera, `createInvoice` antes de guardar.
 * Es un módulo puro (sin imports) para poder probarlo en CI con `node --test`.
 *
 * Principios:
 *  1. Varias lecturas del mismo documento (capa de texto, OCR, IA) son FUENTES del mismo documento:
 *     una línea que aparece en varias fuentes cuenta una vez (máximo por fuente, nunca la suma).
 *     Dentro de una misma fuente, las líneas repetidas se conservan: pueden ser legítimas.
 *  2. Ninguna línea se descarta en silencio: las no verificadas se conservan marcadas para revisión.
 *  3. Si base, impuestos, total o líneas no cuadran dentro de una tolerancia justificada, la factura
 *     queda en revisión y no actualiza historial de precios ni costes.
 *  4. Sin reglas por proveedor.
 */

export type InvoiceSourceKind='text_layer'|'ocr'|'ai'|'manual';

export interface InvoiceCoreLine{
  description:string;
  supplierSku?:string|null;
  quantity?:number|null;
  unit?:string|null;
  unitPrice?:number|null;
  discountPercent?:number|null;
  lineNet?:number|null;
  taxRate?:number|null;
  /** false = el verificador IA no encontró la línea en el documento. null/undefined = sin verificador. */
  verified?:boolean|null;
}

export interface InvoiceCoreSource{kind:InvoiceSourceKind;lines:InvoiceCoreLine[]}

export interface InvoiceCoreHeader{
  supplierName?:string|null;
  supplierTaxId?:string|null;
  invoiceNumber?:string|null;
  invoiceDate?:string|null;
  subtotal?:number|null;
  vat?:number|null;
  equivalenceSurcharge?:number|null;
  withholding?:number|null;
  total?:number|null;
}

export interface InvoiceCorePriorImport{
  invoiceId:string;
  fileHash?:string|null;
  supplierTaxId?:string|null;
  supplierName?:string|null;
  invoiceNumber?:string|null;
  invoiceDate?:string|null;
  total?:number|null;
}

export interface InvoiceCoreInput{
  header:InvoiceCoreHeader;
  sources:InvoiceCoreSource[];
  fileHash?:string|null;
  priorImports?:InvoiceCorePriorImport[];
  /** Texto del documento: solo se usa para explicar diferencias (descuentos, portes…), nunca para corregir. */
  documentText?:string|null;
  /** Facturas de mercancía: deben traer líneas que expliquen la base imponible. */
  requireLines?:boolean;
  allowedTaxRates?:number[];
}

export type InvoiceCoreSeverity='error'|'warning'|'info';
export interface InvoiceCoreIssue{code:string;severity:InvoiceCoreSeverity;message:string;lineIndex?:number}

export interface InvoiceCoreUnitInfo{
  invoiceUnit:string|null;
  innerQty:number|null;
  perPack:Record<string,number>;
  ambiguous:boolean;
  note:string|null;
}

export interface InvoiceCoreCheckedLine extends InvoiceCoreLine{
  index:number;
  sources:InvoiceSourceKind[];
  adjustment:boolean;
  unitInfo:InvoiceCoreUnitInfo;
  /** Motivos que impiden confirmar la factura automáticamente. */
  blocking:string[];
  /** Motivos que solo impiden usar esta línea para costes/historial de precios. */
  priceReview:string[];
  status:'ok'|'review';
}

export interface InvoiceCoreResult{
  status:'ready'|'needs_review'|'duplicate';
  autoConfirmAllowed:boolean;
  lines:InvoiceCoreCheckedLine[];
  totals:{linesNet:number;subtotal:number|null;difference:number|null;tolerance:number};
  issues:InvoiceCoreIssue[];
  duplicateOf:string|null;
  explanation:string|null;
}

const round2=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const isNum=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

export function normalizeInvoiceText(value:string|null|undefined){
  return String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}

/** Identidad de una línea: descripción normalizada (sin espacios) + cantidad + precio + importe. */
export function invoiceLineKey(line:InvoiceCoreLine){
  const quantity=isNum(line.quantity)?String(line.quantity):'';
  const price=isNum(line.unitPrice)?round2(line.unitPrice).toFixed(2):'';
  const net=isNum(line.lineNet)?round2(line.lineNet).toFixed(2):'';
  return [normalizeInvoiceText(line.description),quantity,price,net].join('|');
}

/** ±0,005 € de redondeo por línea + ±0,01 € de la cabecera; mínimo 0,02 €. */
export function invoiceAmountTolerance(lineCount:number){
  return Math.max(0.02,round2(0.005*lineCount+0.01));
}

const ADJUSTMENT_PATTERN=/\b(?:DTO|DESCUENTO|DESC\.?|RAPPEL|BONIFICACION|ABONO|PORTES?|TRANSPORTE|ENVIO|GASTOS?\s+DE\s+ENVIO|RECARGO|AJUSTE|REDONDEO|PRONTO\s+PAGO|ECOTASA|IMPUESTO\s+ESPECIAL|PLASTICO\s+NO\s+REUTILIZABLE|ENVASES?)\b/;
export function isAdjustmentLine(description:string){
  const text=String(description||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();
  return ADJUSTMENT_PATTERN.test(text);
}

function completeness(line?:InvoiceCoreLine){
  if(!line)return -1;
  return (['supplierSku','quantity','unit','unitPrice','lineNet','taxRate'] as const).filter(key=>line[key]!=null).length;
}

export function reconcileInvoiceSources(sources:InvoiceCoreSource[]){
  const perSource=sources.map(source=>{
    const byKey=new Map<string,InvoiceCoreLine[]>();
    for(const line of source.lines){
      const key=invoiceLineKey(line);
      byKey.set(key,[...(byKey.get(key)??[]),line]);
    }
    return {kind:source.kind,byKey};
  });
  const order:string[]=[];
  const seen=new Set<string>();
  for(const source of sources)for(const line of source.lines){
    const key=invoiceLineKey(line);
    if(!seen.has(key)){seen.add(key);order.push(key);}
  }
  const lines:(InvoiceCoreLine&{sources:InvoiceSourceKind[]})[]=[];
  let raw=0;
  for(const source of sources)raw+=source.lines.length;
  for(const key of order){
    let best:InvoiceCoreLine[]=[];
    const kinds:InvoiceSourceKind[]=[];
    for(const source of perSource){
      const bucket=source.byKey.get(key);
      if(!bucket)continue;
      kinds.push(source.kind);
      if(bucket.length>best.length||(bucket.length===best.length&&completeness(bucket[0])>completeness(best[0])))best=bucket;
    }
    best.forEach((line,position)=>{
      const verifiedSomewhere=perSource.some(source=>source.byKey.get(key)?.[position]?.verified===true);
      const rejectedEverywhere=perSource.every(source=>{
        const candidate=source.byKey.get(key)?.[position];
        return !candidate||candidate.verified===false;
      });
      lines.push({...line,verified:verifiedSomewhere?true:rejectedEverywhere?false:line.verified??null,sources:kinds});
    });
  }
  return {lines,collapsed:raw-lines.length};
}

export function findPossibleDuplicateLines(lines:InvoiceCoreLine[]){
  const groups=new Map<string,number[]>();
  lines.forEach((line,index)=>{const key=invoiceLineKey(line);groups.set(key,[...(groups.get(key)??[]),index]);});
  return [...groups.values()].filter(group=>group.length>1);
}

const UNIT_ALIASES:Record<string,string>={
  RETRACTIL:'retractil',RETRACTILES:'retractil',R:'retractil',
  CAJA:'caja',CAJAS:'caja',C:'caja',
  PAQUETE:'paquete',PAQUETES:'paquete',PQ:'paquete',PAQ:'paquete',
  KG:'kg',KILO:'kg',KILOS:'kg',
  UD:'ud',UDS:'ud',UNIDAD:'ud',UNIDADES:'ud',U:'ud',
  MILLAR:'millar',BOBINA:'bobina',ROLLO:'rollo',ROLLOS:'rollo',
};

export function parseInvoiceUnits(description:string,unit?:string|null):InvoiceCoreUnitInfo{
  const text=String(description??'').toUpperCase();
  const invoiceUnit=unit?(UNIT_ALIASES[normalizeInvoiceText(unit)]??unit.toLowerCase()):null;
  const perPack:Record<string,number>={};
  for(const match of text.matchAll(/\b(R|C|PQ|P)\s*\/\s*(\d{1,5})\b/g)){
    const key=match[1]==='R'?'retractil':match[1]==='C'?'caja':'paquete';
    perPack[key]=Number(match[2]);
  }
  const inner=text.match(/\b(\d{2,5})\s*(U|UDS|UD|UNID)\b/);
  const innerQty=inner?Number(inner[1]):null;
  const compound=Boolean(invoiceUnit&&['retractil','caja','millar','paquete','bobina'].includes(invoiceUnit));
  const note=compound
    ?`Precio por ${invoiceUnit}${perPack[invoiceUnit!]?` (${perPack[invoiceUnit!]} subunidades según la descripción)`:''}${innerQty?`; ${innerQty} uds por paquete según la descripción`:''}. Confirma el factor de conversión antes de actualizar costes.`
    :null;
  return {invoiceUnit,innerQty,perPack,ambiguous:compound,note};
}

function moneyValues(text:string){
  const values:number[]=[];
  for(const match of text.matchAll(/-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\b|-?\d+\.\d{2}\b/g)){
    const raw=match[0];
    const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;
    const value=Number(normalized);
    if(Number.isFinite(value))values.push(Math.abs(value));
  }
  return values;
}

/**
 * Busca en el texto del documento un importe igual a la diferencia junto a una palabra de descuento,
 * portes, recargo o redondeo. Solo EXPLICA la diferencia para el revisor; nunca la da por buena.
 */
export function explainInvoiceDifference(difference:number,documentText?:string|null){
  if(!documentText||!isNum(difference)||Math.abs(difference)<0.01)return null;
  const target=round2(Math.abs(difference));
  const labels:[RegExp,string][]=[
    [/\b(?:dto|descuento|desc\.|rappel|bonificaci[oó]n|pronto\s+pago)\b/i,'descuento'],
    [/\b(?:portes?|transporte|env[ií]o|gastos\s+de\s+env[ií]o)\b/i,'transporte'],
    [/\b(?:recargo|impuesto\s+especial|pl[aá]stico|envases?|ecotasa)\b/i,'recargo o impuesto especial'],
    [/\b(?:redondeo|ajuste)\b/i,'redondeo o ajuste'],
  ];
  for(const raw of String(documentText).split(/\r?\n/)){
    const line=raw.trim();
    if(!line)continue;
    for(const [pattern,label] of labels){
      if(!pattern.test(line))continue;
      if(moneyValues(line).some(value=>Math.abs(value-target)<0.011))return `${label} de ${target.toFixed(2)} € indicado en el documento («${line.slice(0,80)}»)`;
    }
  }
  return null;
}

function samePriorImport(input:InvoiceCoreInput){
  const header=input.header;
  for(const prior of input.priorImports??[]){
    if(input.fileHash&&prior.fileHash&&input.fileHash===prior.fileHash)return prior;
    const sameTaxId=normalizeInvoiceText(prior.supplierTaxId)!==''&&normalizeInvoiceText(prior.supplierTaxId)===normalizeInvoiceText(header.supplierTaxId);
    const sameName=normalizeInvoiceText(prior.supplierName)!==''&&normalizeInvoiceText(prior.supplierName)===normalizeInvoiceText(header.supplierName);
    const sameSupplier=sameTaxId||sameName;
    const sameNumber=normalizeInvoiceText(prior.invoiceNumber)!==''&&normalizeInvoiceText(prior.invoiceNumber)===normalizeInvoiceText(header.invoiceNumber);
    if(sameSupplier&&sameNumber)return prior;
    if(sameTaxId&&prior.invoiceDate&&prior.invoiceDate===header.invoiceDate&&isNum(prior.total)&&isNum(header.total)&&Math.abs(prior.total-header.total)<0.01)return prior;
  }
  return null;
}


/**
 * Límites de las columnas numéricas de invoice_lines (numeric(14,4), (14,6), (14,2), (7,4)) y de
 * plausibilidad. Un valor fuera de rango suele ser una referencia o un código leído como cantidad;
 * antes provocaba «numeric field overflow» y la importación guardaba la factura sin ninguna línea.
 */
export const INVOICE_LINE_LIMITS={quantity:1e7,unitPrice:1e7,lineNet:1e9,taxRate:100};
export function implausibleLineValues(line:Pick<InvoiceCoreLine,'quantity'|'unitPrice'|'lineNet'|'taxRate'>){
  const fields:string[]=[];
  if(isNum(line.quantity)&&Math.abs(line.quantity)>=INVOICE_LINE_LIMITS.quantity)fields.push('cantidad');
  if(isNum(line.unitPrice)&&Math.abs(line.unitPrice)>=INVOICE_LINE_LIMITS.unitPrice)fields.push('precio unitario');
  if(isNum(line.lineNet)&&Math.abs(line.lineNet)>=INVOICE_LINE_LIMITS.lineNet)fields.push('importe');
  if(isNum(line.taxRate)&&(line.taxRate<0||line.taxRate>INVOICE_LINE_LIMITS.taxRate))fields.push('tipo de IVA');
  return fields;
}

export function checkInvoiceIntegrity(input:InvoiceCoreInput):InvoiceCoreResult{
  const issues:InvoiceCoreIssue[]=[];
  const allowedTaxRates=input.allowedTaxRates??[0,4,5,10,21];
  const header=input.header;

  const duplicate=samePriorImport(input);
  if(duplicate)issues.push({code:'DUPLICATE_IMPORT',severity:'error',message:`Factura ya importada${duplicate.invoiceNumber?` (${duplicate.invoiceNumber})`:''}. No se crea otra.`});

  const {lines:reconciled,collapsed}=reconcileInvoiceSources(input.sources);
  if(collapsed>0)issues.push({code:'SOURCES_RECONCILED',severity:'info',message:`${collapsed} líneas leídas en más de una fuente del mismo documento se han contado una sola vez.`});

  const lines:InvoiceCoreCheckedLine[]=reconciled.map((line,index)=>{
    const blocking:string[]=[];
    const priceReview:string[]=[];
    // Descuentos, portes, recargos y líneas de abono (importe negativo) son ajustes, no productos.
    const adjustment=isAdjustmentLine(line.description)||(isNum(line.lineNet)&&line.lineNet<0);
    if(line.verified===false)blocking.push('El analizador no encontró esta línea en el documento: revísala (se conserva).');
    const implausible=implausibleLineValues(line);
    if(implausible.length)blocking.push(`Valor imposible en ${implausible.join(', ')} (probablemente un código leído como número).`);
    if(!isNum(line.lineNet))blocking.push('Importe de línea ausente.');
    if(!adjustment){
      if(!isNum(line.quantity)||line.quantity<=0)blocking.push('Cantidad ausente o no positiva.');
      if(isNum(line.unitPrice)&&line.unitPrice<0)blocking.push('Precio unitario negativo en una línea de producto.');
      if(!isNum(line.unitPrice))priceReview.push('Sin precio unitario: no se usa para costes.');
    }
    if(isNum(line.quantity)&&isNum(line.unitPrice)&&isNum(line.lineNet)){
      const expected=round2(line.quantity*line.unitPrice*(1-(line.discountPercent??0)/100));
      // Un precio unitario impreso con 2 decimales puede desviar hasta 0,005 € por unidad.
      const lineTolerance=0.015+Math.abs(line.quantity)*0.005;
      const rates=isNum(line.taxRate)?[line.taxRate]:allowedTaxRates;
      const exactMatch=Math.abs(expected-line.lineNet)<=0.015;
      const vatInclusivePrice=!exactMatch&&rates.some(rate=>rate>0&&Math.abs(expected-line.lineNet!*(1+rate/100))<=lineTolerance*(1+rate/100));
      if(vatInclusivePrice)priceReview.push('El precio unitario parece incluir IVA: no se usa para costes sin confirmar.');
      else if(Math.abs(expected-line.lineNet)>lineTolerance)blocking.push(`Cantidad × precio (${expected.toFixed(2)}) no coincide con el importe (${line.lineNet.toFixed(2)}).`);
    }
    if(isNum(line.taxRate)&&!allowedTaxRates.includes(line.taxRate))blocking.push(`Tipo de IVA ${line.taxRate} % no admitido.`);
    const unitInfo=parseInvoiceUnits(line.description,line.unit);
    if(unitInfo.ambiguous&&!adjustment)priceReview.push(unitInfo.note??'Unidad de compra compuesta sin factor confirmado.');
    return {...line,index,adjustment,unitInfo,blocking,priceReview,status:blocking.length?'review':'ok'};
  });

  const linesNet=round2(lines.reduce((sum,line)=>sum+(isNum(line.lineNet)?line.lineNet:0),0));
  const tolerance=invoiceAmountTolerance(lines.length);
  let difference:number|null=null;
  let explanation:string|null=null;
  const subtotal=isNum(header.subtotal)?header.subtotal:null;

  if(subtotal==null){
    issues.push({code:'MISSING_SUBTOTAL',severity:'error',message:'La cabecera no tiene base imponible.'});
  }else if(lines.length===0){
    if(input.requireLines&&subtotal>0){
      issues.push({code:'MISSING_LINES',severity:'error',message:`Factura de mercancía sin líneas: la base de ${subtotal.toFixed(2)} € no está desglosada. Revisa el documento antes de confirmar.`});
    }
  }else{
    difference=round2(linesNet-subtotal);
    if(Math.abs(difference)>tolerance){
      explanation=explainInvoiceDifference(difference,input.documentText);
      issues.push({code:'LINES_NOT_MATCH_SUBTOTAL',severity:'error',
        message:`Las líneas suman ${linesNet.toFixed(2)} y la base es ${subtotal.toFixed(2)} (diferencia ${difference.toFixed(2)}, tolerancia ${tolerance.toFixed(2)}).${explanation?` Posible causa: ${explanation}.`:''}`});
      const extra=findPossibleDuplicateLines(lines).flatMap(group=>group.slice(1));
      if(extra.length){
        const without=round2(linesNet-extra.reduce((sum,index)=>sum+(isNum(lines[index].lineNet)?lines[index].lineNet as number:0),0));
        const gap=round2(subtotal-without);
        issues.push({code:'SUGGESTION',severity:'info',message:Math.abs(gap)<=tolerance
          ?`Si las líneas ${extra.map(index=>index+1).join(', ')} son duplicados, la factura cuadraría (${without.toFixed(2)}).`
          :`Sin los posibles duplicados (${extra.map(index=>index+1).join(', ')}) las líneas sumarían ${without.toFixed(2)}; aún faltarían ${gap.toFixed(2)} € de líneas no leídas.`});
      }else if(difference<0&&!explanation){
        issues.push({code:'SUGGESTION',severity:'info',message:`Faltan ${Math.abs(difference).toFixed(2)} € de líneas: probablemente hay artículos no leídos.`});
      }
    }
  }

  if(subtotal!=null&&isNum(header.vat)&&isNum(header.total)){
    // La retención se resta siempre (en algunos registros se guarda con signo negativo).
    const expectedTotal=round2(subtotal+header.vat+(header.equivalenceSurcharge??0)-Math.abs(header.withholding??0));
    if(Math.abs(expectedTotal-header.total)>0.02){
      issues.push({code:'HEADER_TOTAL_MISMATCH',severity:'error',message:`Base + IVA + recargo − retención = ${expectedTotal.toFixed(2)} y el total es ${header.total.toFixed(2)}.`});
    }
    const taxed=lines.filter(line=>isNum(line.lineNet)&&isNum(line.taxRate));
    if(lines.length>0&&taxed.length===lines.length){
      const vatFromLines=round2(taxed.reduce((sum,line)=>sum+(line.lineNet as number)*(line.taxRate as number)/100,0));
      if(Math.abs(vatFromLines-header.vat)>Math.max(0.02,0.01*lines.length)){
        issues.push({code:'VAT_MISMATCH',severity:'error',message:`El IVA calculado por líneas es ${vatFromLines.toFixed(2)} y la cabecera indica ${header.vat.toFixed(2)}.`});
      }
    }
  }else{
    issues.push({code:'MISSING_AMOUNTS',severity:'error',message:'Faltan base, IVA o total en la cabecera.'});
  }

  const totalsOk=difference!==null&&Math.abs(difference)<=tolerance;
  // Si las líneas suman exactamente la base, una duda de aritmética en una línea (importe ausente,
  // cantidad × precio) ya no afecta al importe de la factura: solo impide usar esa línea para costes.
  if(totalsOk){
    for(const line of lines){
      const arithmetic=line.blocking.filter(reason=>/^Cantidad × precio|^Importe de línea ausente|^Precio unitario negativo/.test(reason));
      if(arithmetic.length&&arithmetic.length===line.blocking.length){
        line.priceReview.push(...arithmetic);
        line.blocking=[];
        line.status='ok';
      }
    }
  }
  for(const group of findPossibleDuplicateLines(lines)){
    issues.push({code:'POSSIBLE_DUPLICATE_LINES',severity:totalsOk?'info':'warning',
      message:`Líneas ${group.map(index=>index+1).join(', ')} son idénticas. Se conservan${totalsOk?' (los totales cuadran).':'; confirma si son reales.'}`});
    if(!totalsOk)for(const index of group.slice(1)){
      lines[index].blocking.push('Posible duplicado de otra línea.');
      lines[index].status='review';
    }
  }
  for(const line of lines){
    if(line.status==='review')issues.push({code:'LINE_REVIEW',severity:'warning',message:`Línea ${line.index+1}: ${line.blocking.join(' ')}`,lineIndex:line.index});
    else if(line.priceReview.length)issues.push({code:'LINE_PRICE_REVIEW',severity:'info',message:`Línea ${line.index+1}: ${line.priceReview.join(' ')}`,lineIndex:line.index});
  }

  const hasError=issues.some(issue=>issue.severity==='error');
  const hasLineReview=lines.some(line=>line.status==='review');
  const status:InvoiceCoreResult['status']=duplicate?'duplicate':hasError||hasLineReview?'needs_review':'ready';
  return {
    status,
    autoConfirmAllowed:status==='ready',
    lines,
    totals:{linesNet,subtotal,difference,tolerance},
    issues,
    duplicateOf:duplicate?.invoiceId??null,
    explanation,
  };
}

/** Motivos legibles para el revisor (sin los informativos). */
export function invoiceReviewReasons(result:InvoiceCoreResult){
  return result.issues.filter(issue=>issue.severity==='error'||(issue.severity==='warning'&&issue.code!=='LINE_REVIEW')).map(issue=>issue.message)
    .concat(result.lines.filter(line=>line.status==='review').length?[`${result.lines.filter(line=>line.status==='review').length} línea(s) marcadas para revisión.`]:[]);
}

/** Resumen persistible en `invoices.extraction.integrityCheck` (trazabilidad de la decisión). */
export function invoiceIntegritySummary(result:InvoiceCoreResult,checkedAt:string){
  return {
    engine:'invoice-core-v1',
    checkedAt,
    status:result.status,
    autoConfirmAllowed:result.autoConfirmAllowed,
    totals:result.totals,
    explanation:result.explanation,
    issues:result.issues.map(issue=>({code:issue.code,severity:issue.severity,message:issue.message,lineIndex:issue.lineIndex??null})),
    lines:result.lines.map(line=>({
      index:line.index,
      description:line.description,
      supplierSku:line.supplierSku??null,
      quantity:line.quantity??null,
      unit:line.unit??null,
      unitPrice:line.unitPrice??null,
      lineNet:line.lineNet??null,
      taxRate:line.taxRate??null,
      sources:line.sources,
      verified:line.verified??null,
      adjustment:line.adjustment,
      status:line.status,
      blocking:line.blocking,
      priceReview:line.priceReview,
    })),
  };
}

export interface StoredInvoiceForCheck{
  subtotal:number;
  vat:number;
  equivalenceSurcharge?:number|null;
  withholding?:number|null;
  total:number;
  /** Aviso guardado por el importador cuando no pudo insertar las líneas (p. ej. desbordamiento numérico). */
  lineImportWarning?:string|null;
  detectedLineCount?:number|null;
  lines:Array<{description:string;supplierSku?:string|null;quantity?:number|null;unit?:string|null;unitPrice?:number|null;lineNet?:number|null;taxRate?:number|null}>;
}

/**
 * Revisión de solo lectura de una factura ya guardada (incluidas las históricas).
 * No corrige nada: devuelve los motivos para mostrarlos al usuario.
 */
/** Factura de mercancía que debe traer líneas: categoría de mercancía y proveedor no clasificado como servicio. */
export function storedInvoiceRequiresLines(categoryName:string|null|undefined,supplierType?:string|null){
  return /^mercanc[ií]a$/i.test(String(categoryName??'').trim())&&supplierType!=='service';
}

export function checkStoredInvoice(invoice:StoredInvoiceForCheck,options:{merchandise?:boolean}={}){
  const result=checkInvoiceIntegrity({
    header:{subtotal:invoice.subtotal,vat:invoice.vat,equivalenceSurcharge:invoice.equivalenceSurcharge??0,withholding:invoice.withholding??0,total:invoice.total},
    sources:[{kind:'manual',lines:invoice.lines.map(line=>({
      description:line.description,supplierSku:line.supplierSku??null,quantity:line.quantity??null,unit:line.unit??null,
      unitPrice:line.unitPrice??null,lineNet:line.lineNet??null,taxRate:line.taxRate??null,
    }))}],
    requireLines:Boolean(options.merchandise),
  });
  const issues=[...result.issues];
  let status=result.status;
  if(invoice.lineImportWarning&&invoice.lines.length===0){
    const detected=Number(invoice.detectedLineCount)||0;
    issues.unshift({code:'LINES_NOT_SAVED',severity:'error',message:`Se detectaron ${detected||'varias'} línea(s) pero no se guardaron (${invoice.lineImportWarning}). Reimporta el documento o añade las líneas.`});
    if(status==='ready')status='needs_review';
  }
  const reasons=invoice.lineImportWarning&&invoice.lines.length===0?[issues[0].message,...invoiceReviewReasons(result)]:invoiceReviewReasons(result);
  return {status,reasons,totals:result.totals,issues};
}
