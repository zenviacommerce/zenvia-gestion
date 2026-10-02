import type { ExpenseCategory } from '../types';
import { parseInvoiceText, readInvoiceDocument, type InvoiceReadResult } from './invoiceReader';
import { detectMerchandiseCategory, extractCompactProductLines, extractServiceTableLines, extractStructuredProductLines, extractSupplierV2, repairInvoiceAmounts } from './invoiceReaderV2';
import { getCashSierraNevadaProductLines, getRetailInvoiceCorrection } from './invoiceRetailCorrections';
import { canonicalizeSupplierName, extractExplicitLegalSupplier } from './supplierIdentity';
import { splitBundledInvoiceText, structuralInvoiceCount } from './invoiceBundle';
import { reconcileInvoiceFiscalAmounts } from './invoiceFiscalReconciler';
import { analyzeInvoiceWithIntelligence, type InvoiceIntelligenceMode } from './invoiceIntelligence';

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const moneyToken = /-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2,6}|-?\d+\.\d{2,6}/g;

export class MultiInvoiceDocumentError extends Error {
  invoiceNumbers: string[];

  constructor(invoiceNumbers: string[]) {
    const sample = invoiceNumbers.slice(0, 6).join(', ');
    const suffix = invoiceNumbers.length > 6 ? ', …' : '';
    super(`Este PDF contiene varias facturas o abonos${sample ? ` (${sample}${suffix})` : ''}. Por seguridad no se importará como una única factura. Divide el documento por factura o revísalo manualmente.`);
    this.name = 'MultiInvoiceDocumentError';
    this.invoiceNumbers = invoiceNumbers;
  }
}

export function isMultiInvoiceDocumentError(error: unknown): error is MultiInvoiceDocumentError {
  return error instanceof MultiInvoiceDocumentError
    || (error instanceof Error && error.name === 'MultiInvoiceDocumentError');
}

function parseMoney(value: string | undefined | null) {
  if (!value) return 0;
  const cleaned = value.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma > lastDot) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma) normalized = cleaned.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineMoneyValues(line: string) {
  return [...line.matchAll(moneyToken)].map(match => parseMoney(match[0])).filter(value => Number.isFinite(value));
}

function detectBundledInvoiceNumbers(lines: string[], fullText: string) {
  const numbers = new Set<string>();

  for (const line of lines) {
    const summary = line.match(/\b(?:factura|abono)\s+[—-]?\s*(\d{3,12})\s+\d{2}\/\d{2}\/\d{2,4}\b/i)?.[1];
    if (summary) numbers.add(summary);
  }

  const taxSections = (fullText.match(/desglose\s+de\s+impuestos/gi) || []).length;
  if (taxSections >= 2) {
    for (const line of lines) {
      const datedNumber = line.match(/\b\d{2}\/\d{2}\/\d{2,4}\s+(\d{5,12})\s*$/)?.[1];
      if (datedNumber) numbers.add(datedNumber);
    }
  }

  const looksLikeCustomerStatement = /\bventas?\s+por\s+cliente\b|\btotal\s+cliente\s*:/i.test(fullText);
  if (numbers.size >= 2 && (looksLikeCustomerStatement || taxSections >= 2)) return [...numbers];
  return [];
}

function normalizeInvoiceNumberCandidate(value: string | undefined | null) {
  const candidate = compact(String(value || ''))
    .replace(/^[#:\s-]+/, '')
    .replace(/[.,;:\s]+$/, '');
  if (!candidate || candidate.length < 3 || candidate.length > 60) return '';

  // Un número de factura real debe contener al menos un dígito. Esto evita que
  // ciudades, cabeceras o palabras próximas a «Factura» terminen como número.
  if (!/\d/.test(candidate)) return '';

  // Una fecha nunca debe convertirse en número de factura.
  if (/^\d{1,2}[-/.]\d{1,2}[-/.](?:\d{2}|\d{4})$/.test(candidate)) return '';
  if (/^20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(candidate)) return '';
  if (/^\d{1,2}[-/.](?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|ene|abr|ago|dic)[a-záéíóú]*[-/.](?:\d{2}|\d{4})$/i.test(candidate)) return '';

  // Rechazamos etiquetas conocidas aunque un OCR les haya añadido algún símbolo.
  if (/^(?:factura|invoice|original|copia|fecha|date|proforma)$/i.test(candidate)) return '';

  return candidate;
}

function invoiceNumberDistance(a:string,b:string){
  if(a===b)return 0;
  const previous=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i+=1){
    let diagonal=previous[0];
    previous[0]=i;
    for(let j=1;j<=b.length;j+=1){
      const above=previous[j];
      const cost=a[i-1]===b[j-1]?0:1;
      previous[j]=Math.min(previous[j]+1,previous[j-1]+1,diagonal+cost);
      diagonal=above;
    }
  }
  return previous[b.length];
}

function invoiceNumberFromFilename(filename: string) {
  const base = filename.trim().replace(/\.[^.]+$/, '');

  // PDFs cuyo nombre es el propio número: Google, FedEx, etc.
  if (/^\d{6,20}$/.test(base)) return base;

  // Sendcloud_invoice_1-26-ES0047507_1-9-2026.pdf
  const labelled = base.match(/(?:invoice|factura)[_-]+((?:[A-Z0-9]+-){2,}[A-Z0-9]+)/i)?.[1];
  const validLabelled = normalizeInvoiceNumberCandidate(labelled);
  if (validLabelled) return validLabelled;

  // A28799120_15436385G_F260510648_2026.pdf
  const prefixed = base.match(/(?:^|[_-])([A-Z]\d{5,20})(?=[_-]|$)/i)?.[1];
  const validPrefixed = normalizeInvoiceNumberCandidate(prefixed);
  if (validPrefixed) return validPrefixed;

  // TRUFA_PET_585256540.pdf
  const trailingDigits = base.match(/(?:^|[\s_-])(\d{6,20})$/)?.[1];
  return normalizeInvoiceNumberCandidate(trailingDigits);
}

function explicitInvoiceNumber(text: string, lines: string[]) {
  // Priorizamos etiquetas inequívocas. Los patrones genéricos quedan al final para
  // evitar errores como «Factura Dublin 2» -> Dublin o «Factura original» -> original.
  const patterns = [
    /\bn[uú]mero\s+(?:de\s+)?factura\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bn(?:º|°|o)\.?\s*factura\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bbill\s*#\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\binvoice\s+(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bfactura\s+(?:n(?:º|°|o)\.?|n[uú]m(?:ero)?\.?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bfactura\s+([A-Z]*\d[A-Z0-9._\/-]{2,})\b/i,
    /\b(?:numero\s+fattura|fattura\s*(?:n\.?|no\.?|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\b(?:numero\s+(?:da\s+)?fatura|fatura\s*(?:n\.?|no\.?|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\b(?:numero\s+de\s+facture|facture\s*(?:n\.?|no\.?|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\b(?:rechnungs(?:nummer|nr\.?)|rechnung\s*(?:nr\.?|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
  ];
  for (const pattern of patterns) {
    const value = normalizeInvoiceNumberCandidate(text.match(pattern)?.[1]);
    if (value) return value;
  }

  // Formato frecuente en facturas de Sierra Nevada: la fecha y el número
  // aparecen al final de la línea de forma de pago, sin una etiqueta intermedia.
  for (const line of lines) {
    const value = normalizeInvoiceNumberCandidate(line.match(/\b\d{2}\/\d{2}\/\d{2,4}\s+(\d{5,12})\s*$/)?.[1]);
    if (value) return value;
  }
  return '';
}

function explicitTaxBase(text: string) {
  const patterns = [
    /\bimporte\s+base\s+total\s*[:#-]?\s*(-?[\d.,]+)\s*(?:€|eur)?/i,
    /\bbase\s+imponible(?:\s+total)?\s*[:#-]?\s*(-?[\d.,]+)\s*(?:€|eur)?/i,
    /\bsubtotal\s*[:#-]?\s*(-?[\d.,]+)\s*(?:€|eur)?/i,
    /\bimporte\s+neto\s*[:#-]?\s*(-?[\d.,]+)\s*(?:€|eur)?/i,
  ];
  for (const pattern of patterns) {
    const amount = parseMoney(text.match(pattern)?.[1]);
    if (amount > 0) return amount;
  }
  return 0;
}

type FiscalSummary = { subtotal: number; vat: number; total: number; rate: number };

function extractFiscalSummary(lines: string[]): FiscalSummary | null {
  let marker = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/desglose\s+de\s+impuestos/i.test(lines[index])) {
      marker = index;
      break;
    }
  }
  if (marker < 0) return null;

  for (let index = marker + 1; index <= Math.min(lines.length - 1, marker + 12); index += 1) {
    const line = lines[index];
    const rateRaw = line.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/)?.[1];
    const rate = parseMoney(rateRaw);
    if (!rate || rate > 30) continue;

    const withoutRate = line.replace(/\d{1,2}(?:[.,]\d{1,2})?\s*%/, ' ');
    const values = lineMoneyValues(withoutRate).filter(value => Math.abs(value) < 10_000_000);
    if (values.length < 2) continue;

    const subtotal = values.at(-2) || 0;
    const vat = values.at(-1) || 0;
    if (subtotal <= 0 || vat < 0) continue;

    const expectedVat = Math.round(subtotal * rate) / 100;
    const tolerance = Math.max(0.10, Math.abs(expectedVat) * 0.015);
    if (Math.abs(vat - expectedVat) > tolerance) continue;

    const expectedTotal = Math.round((subtotal + vat) * 100) / 100;
    let total = 0;
    for (let totalIndex = index + 1; totalIndex <= Math.min(lines.length - 1, index + 10); totalIndex += 1) {
      const totalValues = lineMoneyValues(lines[totalIndex]);
      const matching = totalValues.find(value => Math.abs(value - expectedTotal) <= 0.10);
      if (matching != null) {
        total = matching;
        break;
      }
      if (/\b(?:total\s+factura|importe\s+total|total\s+a\s+pagar)\b/i.test(lines[totalIndex])) {
        const labelled = totalValues.at(-1);
        if (labelled != null && labelled > 0) {
          total = labelled;
          break;
        }
      }
    }

    return { subtotal, vat, total: total || expectedTotal, rate };
  }
  return null;
}

function extractLooseFiscalSummary(lines:string[]):FiscalSummary|null{
  for(let marker=lines.length-1;marker>=0;marker-=1){
    const line=lines[marker];
    if(!/base\s+imponible/i.test(line))continue;
    if(!/(?:i\.?v\.?a\.?|iva|importe\s+i\.?v\.?a\.?|total\s+factura)/i.test(line))continue;

    const window=lines.slice(marker,Math.min(lines.length,marker+6)).join(' ');
    const tokens=[...window.matchAll(moneyToken)].map(match=>parseMoney(match[0])).filter(value=>value>0&&value<10_000_000);
    if(tokens.length<3)continue;

    for(let baseIndex=0;baseIndex<tokens.length;baseIndex+=1){
      const subtotal=tokens[baseIndex];
      if(subtotal<=0)continue;
      for(let rateIndex=baseIndex+1;rateIndex<tokens.length;rateIndex+=1){
        const rate=tokens[rateIndex];
        if(rate<=0||rate>30)continue;
        for(let vatIndex=rateIndex+1;vatIndex<tokens.length;vatIndex+=1){
          const vat=tokens[vatIndex];
          const expectedVat=Math.round(subtotal*rate)/100;
          const vatTolerance=Math.max(.12,Math.abs(expectedVat)*.02);
          if(Math.abs(vat-expectedVat)>vatTolerance)continue;
          const expectedTotal=Math.round((subtotal+vat)*100)/100;
          const total=tokens.slice(vatIndex+1).find(value=>Math.abs(value-expectedTotal)<=Math.max(.12,expectedTotal*.002))||expectedTotal;
          return {subtotal,vat,total,rate};
        }
      }
    }
  }
  return null;
}

function inferFiscalFromKnownSubtotal(lines:string[],subtotal:number):FiscalSummary|null{
  if(!(subtotal>0))return null;
  let marker=-1;
  for(let index=lines.length-1;index>=0;index-=1){
    if(/desglose\s+de\s+impuestos|%\s*(?:i\.?v\.?a\.?|iva)/i.test(lines[index])){marker=index;break;}
  }
  if(marker<0)return null;
  const end=Math.min(lines.length,marker+14);
  const window=lines.slice(marker,end);
  const allValues=window.flatMap(line=>lineMoneyValues(line).map(value=>({value,line})));
  const rates=window.flatMap(line=>[...line.matchAll(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/g)].map(match=>parseMoney(match[1]))).filter(rate=>rate>0&&rate<=30);
  const uniqueRates=[...new Set(rates)];
  for(const rate of uniqueRates){
    const expectedVat=Math.round(subtotal*rate)/100;
    const vatCandidate=allValues.find(item=>Math.abs(item.value-expectedVat)<=Math.max(.12,expectedVat*.02));
    if(!vatCandidate)continue;
    const vat=vatCandidate.value;
    const expectedTotal=Math.round((subtotal+vat)*100)/100;
    const totalCandidate=allValues.find(item=>Math.abs(item.value-expectedTotal)<=Math.max(.12,expectedTotal*.002));
    return {subtotal,vat,total:totalCandidate?.value||expectedTotal,rate};
  }
  return null;
}

function inferFiscalClosureByArithmetic(lines:string[],subtotal:number):FiscalSummary|null{
  if(!(subtotal>0))return null;
  let start=Math.max(0,lines.length-24);
  const labelled=lines.findIndex(line=>/desglose\s+de\s+impuestos|importe\s+iva|total\s+factura|base\s+imponible/i.test(line));
  if(labelled>=0)start=Math.max(0,labelled-2);
  const window=lines.slice(start);
  const values=window.flatMap((line,lineOffset)=>lineMoneyValues(line).map(value=>({value,lineOffset,line})))
    .filter(item=>item.value>0&&item.value<10_000_000);
  let best:{vat:number;total:number;score:number}|null=null;
  for(const vatCandidate of values){
    const rate=vatCandidate.value/subtotal;
    if(rate<.01||rate>.30)continue;
    const expectedTotal=Math.round((subtotal+vatCandidate.value)*100)/100;
    for(const totalCandidate of values){
      if(totalCandidate===vatCandidate)continue;
      const tolerance=Math.max(.12,expectedTotal*.0015);
      const diff=Math.abs(totalCandidate.value-expectedTotal);
      if(diff>tolerance)continue;
      let score=100-diff*100;
      if(/iva|impuesto/i.test(vatCandidate.line))score+=20;
      if(/total\s+factura|importe\s+total|a\s+pagar/i.test(totalCandidate.line))score+=24;
      if(/desglose\s+de\s+impuestos/i.test(window.slice(0,Math.max(vatCandidate.lineOffset,totalCandidate.lineOffset)+1).join(' ')))score+=8;
      if(!best||score>best.score)best={vat:vatCandidate.value,total:totalCandidate.value,score};
    }
  }
  if(!best)return null;
  return {subtotal,vat:best.vat,total:best.total,rate:best.vat/subtotal*100};
}

function extractReverseChargeFiscalSummary(lines:string[]):FiscalSummary|null{
  const text=lines.join(' ');
  if(!/inv\.?\s*pasivo|reverse\s+charge|inversi[oó]n\s+del\s+sujeto\s+pasivo/i.test(text))return null;
  let subtotal=0,total=0;
  for(let index=lines.length-1;index>=0;index-=1){
    const line=lines[index];
    if(!subtotal&&/base\s+imponible(?:\s*\(sin\s+iva\))?|subtotal|importe\s+neto/i.test(line))subtotal=lineMoneyValues(line).at(-1)||0;
    if(!total&&/importe\s+total|total\s+factura|total\s+a\s+pagar/i.test(line))total=lineMoneyValues(line).at(-1)||0;
    if(subtotal>0&&total>0)break;
  }
  if(subtotal>0&&total>0&&Math.abs(subtotal-total)<=Math.max(.08,total*.0025)){
    return {subtotal,vat:0,total,rate:0};
  }
  return null;
}

function normalizedCategoryName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function findCategory(categories: ExpenseCategory[], needle: RegExp) {
  return categories.find(category => needle.test(normalizedCategoryName(category.name)))?.id;
}

/**
 * Segunda barrera antes de considerar una factura como mercancía. Las tablas de
 * honorarios, cuotas, portes o suscripciones pueden parecer tablas de artículos
 * al OCR, pero sus conceptos no deben crear registros en el maestro de productos.
 */
function serviceCategoryByContent(categories: ExpenseCategory[], text: string) {
  if (/\b(honorarios|minuta|registro\s+mercantil|registrador(?:es)?|asesor[ií]a|gestor[ií]a|consultor[ií]a|abogad[oa]|servicios?\s+profesionales?)\b/i.test(text)) {
    return findCategory(categories, /servicios? profesionales?/);
  }
  if (/\b(suscripci[oó]n|subscription|licencia|license|software|cloud|workspace|hosting|saas)\b/i.test(text)) {
    return findCategory(categories, /software|suscripciones?/);
  }
  if (/\b(transporte|log[ií]stica|portes?|env[ií]o|shipping|freight|courier|fedex|mrw|correos express)\b/i.test(text)) {
    return findCategory(categories, /transporte|logistica/);
  }
  if (/\b(publicidad|marketing|campaign|campa[nñ]a|ads?|google ads|meta ads)\b/i.test(text)) {
    return findCategory(categories, /publicidad|marketing/);
  }
  if (/\b(comisi[oó]n|commission|marketplace|amazon fees?|seller fees?)\b/i.test(text)) {
    return findCategory(categories, /comisiones?|marketplaces?/);
  }
  return undefined;
}

function enhanceInvoiceReadResult(
  base:InvoiceReadResult,
  file:File,
  categories:ExpenseCategory[],
  options:{allowFilenameNumber?:boolean}={},
):InvoiceReadResult{
  const textLines=base.text.split(/\r?\n/).map(compact).filter(Boolean);
  const supplierName=canonicalizeSupplierName(
    extractExplicitLegalSupplier(textLines)
      || extractSupplierV2(textLines,base.text)
      || base.supplierName,
  );
  const explicitNumber=explicitInvoiceNumber(base.text,textLines);
  const filenameNumber=options.allowFilenameNumber===false?'':invoiceNumberFromFilename(file.name);
  const baseNumber=normalizeInvoiceNumberCandidate(base.invoiceNumber);
  const filenameAgreesWithOcr=Boolean(
    explicitNumber&&filenameNumber&&
    explicitNumber.length===filenameNumber.length&&
    invoiceNumberDistance(explicitNumber,filenameNumber)<=1
  );
  const invoiceNumber=filenameAgreesWithOcr?filenameNumber:(explicitNumber||filenameNumber||baseNumber);
  const retailCorrection=getRetailInvoiceCorrection(textLines,base.text);
  const cashSierraLines=getCashSierraNevadaProductLines(textLines,base.text);
  const structuredLines=extractStructuredProductLines(textLines);
  const compactProductLines=extractCompactProductLines(textLines);
  const serviceLines=extractServiceTableLines(textLines);
  const specializedLines=structuredLines.length>=2
    ?structuredLines
    :compactProductLines.length>=2
      ?compactProductLines
      :serviceLines.length>=2
        ?serviceLines
        :[];
  const invoiceLines=retailCorrection?retailCorrection.lines:cashSierraLines.length?cashSierraLines:specializedLines.length?specializedLines:base.lines;
  const merchandiseCategoryId=detectMerchandiseCategory(categories,base.text,invoiceLines);
  const serviceCategoryId=merchandiseCategoryId?undefined:serviceCategoryByContent(categories,base.text);
  const categoryId=merchandiseCategoryId||serviceCategoryId||base.categoryId;
  const repaired=repairInvoiceAmounts(base.subtotal,base.vat,base.withholding,base.total,textLines);
  const explicitSubtotal=explicitTaxBase(base.text);
  const reverseCharge=/inv\.?\s*pasivo|reverse\s+charge|inversi[oó]n\s+del\s+sujeto\s+pasivo/i.test(base.text);
  const reverseChargeSummary=extractReverseChargeFiscalSummary(textLines);
  const initialFiscalSummary=reverseCharge?reverseChargeSummary:extractFiscalSummary(textLines)||extractLooseFiscalSummary(textLines);
  const knownSubtotal=initialFiscalSummary?.subtotal||explicitSubtotal||repaired.subtotal;
  const fiscalSummary=reverseCharge
    ?reverseChargeSummary
    :(initialFiscalSummary
      ||inferFiscalFromKnownSubtotal(textLines,knownSubtotal)
      ||inferFiscalClosureByArithmetic(textLines,knownSubtotal));
  const effectiveSubtotal=retailCorrection
    ?retailCorrection.subtotal
    :fiscalSummary?.subtotal||explicitSubtotal||repaired.subtotal;
  const effectiveTotal=retailCorrection
    ?retailCorrection.total
    :fiscalSummary?.total||repaired.total;
  const reverseChargeTotal=Math.round((effectiveSubtotal-base.withholding)*100)/100;
  const provisionalVat=retailCorrection
    ?retailCorrection.vat
    :reverseCharge&&effectiveSubtotal>0&&effectiveTotal>0&&Math.abs(reverseChargeTotal-effectiveTotal)<=0.02
      ?0
      :fiscalSummary?.vat??base.vat;
  const reconciled=retailCorrection||reverseCharge
    ?null
    :reconcileInvoiceFiscalAmounts(base.text,{
        subtotal:effectiveSubtotal,
        vat:provisionalVat,
        total:effectiveTotal,
        withholding:base.withholding,
      });
  const finalSubtotal=reconciled?.subtotal??effectiveSubtotal;
  const vat=reconciled?.vat??provisionalVat;
  const finalTotal=reconciled?.total??effectiveTotal;

  const gainedSupplier=supplierName&&supplierName!==base.supplierName;
  const gainedNumber=invoiceNumber&&invoiceNumber!==base.invoiceNumber;
  const gainedSubtotal=Math.abs(finalSubtotal-base.subtotal)>0.01;
  const gainedVat=Math.abs(vat-base.vat)>0.01;
  const gainedLines=retailCorrection?invoiceLines.length>0:cashSierraLines.length?cashSierraLines.length>=base.lines.length:specializedLines.length>=2&&specializedLines.length>=base.lines.length;
  const confidenceBoost=(gainedSupplier?0.06:0)
    +(gainedNumber?0.05:0)
    +(gainedSubtotal?0.04:0)
    +(gainedVat?0.08:0)
    +(gainedLines?0.08:0)
    +(retailCorrection?0.06:0)
    +(reconciled?.corrected?0.12:0);

  return {
    ...base,
    supplierName,
    invoiceNumber,
    categoryId,
    subtotal:finalSubtotal,
    vat,
    total:finalTotal,
    lines:invoiceLines,
    confidence:Math.min(0.99,base.confidence+confidenceBoost),
  };
}

function detectBundledDocument(base:InvoiceReadResult){
  const textLines=base.text.split(/\r?\n/).map(compact).filter(Boolean);
  const numbers=detectBundledInvoiceNumbers(textLines,base.text);
  const blocks=splitBundledInvoiceText(base.text);
  const count=Math.max(numbers.length,blocks.length,structuralInvoiceCount(base.text));
  return {numbers,blocks,count};
}

export async function readInvoiceDocumentsEnhanced(
  file:File,
  categories:ExpenseCategory[],
  onProgress?:(message:string)=>void,
  options:{mode?:InvoiceIntelligenceMode}={},
):Promise<InvoiceReadResult[]>{
  const mode=options.mode||'expense';
  const base=await readInvoiceDocument(file,categories,onProgress);
  const bundled=detectBundledDocument(base);

  if(bundled.blocks.length>=2){
    onProgress?.(`Separando ${bundled.blocks.length} facturas detectadas…`);
    const deterministic=bundled.blocks.map(text=>
      enhanceInvoiceReadResult(
        parseInvoiceText(text,categories,base.usedOcr),
        file,
        categories,
        {allowFilenameNumber:false},
      )
    );
    onProgress?.('Validando cada factura con IA y evidencia documental…');
    return Promise.all(deterministic.map(result=>analyzeInvoiceWithIntelligence(undefined,result,mode)));
  }

  if(bundled.count>=2){
    throw new MultiInvoiceDocumentError(
      bundled.numbers.length?bundled.numbers:Array.from({length:bundled.count},(_,index)=>`Factura ${index+1}`),
    );
  }

  onProgress?.('Reconstruyendo proveedor, fiscalidad y líneas de producto…');
  const deterministic=enhanceInvoiceReadResult(base,file,categories);
  onProgress?.('Contrastando la lectura con IA y evidencia documental…');
  return [await analyzeInvoiceWithIntelligence(file,deterministic,mode)];
}

export async function readInvoiceDocumentEnhanced(
  file:File,
  categories:ExpenseCategory[],
  onProgress?:(message:string)=>void,
  options:{mode?:InvoiceIntelligenceMode}={},
):Promise<InvoiceReadResult>{
  const results=await readInvoiceDocumentsEnhanced(file,categories,onProgress,options);
  if(results.length!==1){
    throw new MultiInvoiceDocumentError(results.map(result=>result.invoiceNumber).filter(Boolean));
  }
  return results[0];
}
