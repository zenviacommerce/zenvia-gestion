import jsPDF from 'jspdf';
import type { BusinessSettings, SalesInvoice } from './sales';
import { DEFAULT_APP_SETTINGS, type GeneralSettings, type SalesSettings } from './settingsSchema';
import { formatAppDate, formatAppMoney, invoiceDocumentLabels, localeForLanguage } from './formatting';
import type {VerifactuPreviewBlock} from './verifactuQr';

export type InvoicePdfBranding = {
  logoDataUrl?: string | null;
  /** Offline synthetic review only; ordinary PDF callers never supply this. */
  verifactuPreview?:VerifactuPreviewBlock;
};

export function salesInvoicePdfFilename(invoice:SalesInvoice){
  const number=invoice.invoiceNumber||'BORRADOR';
  return `${number.replace(/[^A-Za-z0-9_-]+/g,'_')}.pdf`;
}

function addLogo(doc:jsPDF,logoDataUrl?:string|null,offset=0){
  if(!logoDataUrl)return 0;
  try{
    const image=doc.getImageProperties(logoDataUrl);
    const maxWidth=56;const maxHeight=20;const ratio=image.width/image.height;
    let width=maxWidth;let height=width/ratio;
    if(height>maxHeight){height=maxHeight;width=height*ratio;}
    doc.addImage(logoDataUrl,undefined as any,14,11+offset,width,height,undefined,'FAST');
    return height;
  }catch{return 0;}
}

export function createSalesInvoicePdfBlob(
  invoice:SalesInvoice,
  settings?:BusinessSettings|null,
  branding?:InvoicePdfBranding|null,
  salesSettings?:SalesSettings|null,
  generalSettings:GeneralSettings=DEFAULT_APP_SETTINGS.general,
){
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const labels=invoiceDocumentLabels(generalSettings.documentLanguage);
  const locale=localeForLanguage(generalSettings.documentLanguage);
  const money=(value:number)=>formatAppMoney(value,invoice.currency,generalSettings,{minimumFractionDigits:2,maximumFractionDigits:2});
  const dateLabel=(value:string)=>formatAppDate(value,generalSettings,'');
  const issuerName=invoice.issuerName||settings?.legalName||'ZENVIA COMMERCE SL';
  const issuerTaxId=invoice.issuerTaxId||settings?.taxId||'';
  const issuerAddress=invoice.issuerAddress||[settings?.addressLine1,settings?.addressLine2,[settings?.postalCode,settings?.city].filter(Boolean).join(' '),settings?.province,settings?.countryCode].filter(Boolean).join(', ');
  const issuerEmail=invoice.issuerEmail||settings?.email||'';
  const issuerPhone=invoice.issuerPhone||settings?.phone||'';
  const taxLabel=invoice.issuerTaxRegistrationLabel||invoice.taxRegistrationLabel||'';
  const taxCountry=invoice.issuerTaxCountryCode||invoice.taxRegistrationCountryCode||'';
  const number=invoice.invoiceNumber||labels.draftInvoice;
  const title=invoice.status==='draft'
    ?(invoice.invoiceType==='rectifying'?labels.draftRectifyingInvoice:labels.draftInvoice)
    :(invoice.invoiceType==='rectifying'?labels.rectifyingInvoice:labels.invoice);

  const preview=branding?.verifactuPreview;
  const offset=preview?50:0;
  if(preview){
    if(preview.syntheticPreview!==true||!preview.url.startsWith('https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?'))throw new Error('VF_PDF_PREVIEW_ONLY');
    const qr=new URL(preview.url);const q=qr.searchParams;
    if(q.get('nif')!==issuerTaxId||q.get('numserie')!==invoice.invoiceNumber||q.get('fecha')!==invoice.issueDate.slice(8,10)+'-'+invoice.issueDate.slice(5,7)+'-'+invoice.issueDate.slice(0,4)||q.get('importe')!==invoice.totalAmount.toFixed(2))throw new Error('VF_PDF_QR_MISMATCH');
    const size=preview.matrix.size;const unit=35/(size+8);
    doc.setFillColor(255,255,255);doc.rect(14,10,35,35,'F');doc.setFillColor(0,0,0);
    for(let row=0;row<size;row++)for(let col=0;col<size;col++)if(preview.matrix.data[row*size+col])doc.rect(14+(col+4)*unit,10+(row+4)*unit,unit,unit,'F');
    doc.link(14,10,35,35,{url:preview.url});
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text(doc.splitTextToSize(preview.label,135),55,20);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text('QR de pruebas. No acredita el envío ni la aceptación por la AEAT.',55,35);
  }
  const logoHeight=addLogo(doc,branding?.logoDataUrl,offset);
  let issuerY=(logoHeight?14+logoHeight+4:16)+offset;
  doc.setFont('helvetica','bold');doc.setFontSize(10.5);doc.text(issuerName,14,issuerY);
  issuerY+=5;doc.setFont('helvetica','normal');doc.setFontSize(8.5);
  if(issuerTaxId&&(salesSettings?.showFiscalDataOnPdf??true)){doc.text(`${taxCountry&&taxCountry!=='ES'?'VAT':labels.taxId}${taxLabel?` · ${taxLabel}`:''}: ${issuerTaxId}`,14,issuerY);issuerY+=4.5;}
  const issuerLines=doc.splitTextToSize(issuerAddress||'',78);if(issuerLines.length){doc.text(issuerLines,14,issuerY);issuerY+=issuerLines.length*4;}
  if(issuerEmail){doc.text(issuerEmail,14,issuerY);issuerY+=4;}
  if(issuerPhone){doc.text(issuerPhone,14,issuerY);issuerY+=4;}

  doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text(title,196,16+offset,{align:'right'});
  doc.setFontSize(11);doc.text(number,196,24+offset,{align:'right'});doc.setFont('helvetica','normal');doc.setFontSize(9);
  doc.text(`${labels.date}: ${dateLabel(invoice.issueDate)}`,196,31+offset,{align:'right'});
  if(invoice.dueDate&&(salesSettings?.showDueDateOnPdf??true))doc.text(`${labels.dueDate}: ${dateLabel(invoice.dueDate)}`,196,37+offset,{align:'right'});
  if(invoice.operationDate)doc.text(`${labels.operationDate}: ${dateLabel(invoice.operationDate)}`,196,43+offset,{align:'right'});

  const blockY=Math.max(60+offset,issuerY+7);
  doc.setDrawColor(210);doc.line(14,blockY-5,196,blockY-5);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text(labels.billTo,14,blockY);doc.setFont('helvetica','normal');
  let clientY=blockY+7;doc.setFontSize(10);doc.text(invoice.clientName,14,clientY);clientY+=6;doc.setFontSize(8.8);
  if(invoice.clientTaxId&&(salesSettings?.showFiscalDataOnPdf??true)){doc.text(`${labels.taxId}: ${invoice.clientTaxId}`,14,clientY);clientY+=4.5;}
  const clientAddress=doc.splitTextToSize(invoice.clientAddress||'',90);if(clientAddress.length){doc.text(clientAddress,14,clientY);clientY+=clientAddress.length*4;}
  if(invoice.clientEmail){doc.text(invoice.clientEmail,14,clientY);clientY+=4;}
  if(invoice.clientPhone){doc.text(invoice.clientPhone,14,clientY);clientY+=4;}

  let y=Math.max(blockY+34,clientY+7);
  if(invoice.invoiceType==='rectifying'&&invoice.rectifiesInvoiceId){
    const reference=[`Rectifica: ${invoice.rectificationOriginalNumber||invoice.rectifiesInvoiceId} · ${dateLabel(invoice.rectificationOriginalDate||invoice.issueDate)}`,`${invoice.verifactuType||''} · ${invoice.rectificationMode==='S'?'Por sustitución (importes correctos finales)':'Por diferencias (ajuste firmado)'}`,`Motivo: ${invoice.rectificationReason||''}`];
    if(invoice.rectificationMode==='S')reference.push(`Base rectificada: ${money(invoice.rectificationOriginalBase??0)} · Cuota rectificada: ${money(invoice.rectificationOriginalTax??0)}`);
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);
    for(const text of reference)for(const row of doc.splitTextToSize(text,178)){
      if(y>265){doc.addPage();y=22;}doc.text(row,14,y);y+=4.5;
    }
    y+=5;
  }
  doc.setFillColor(245,247,249);doc.rect(14,y-5,182,8,'F');doc.setFont('helvetica','bold');doc.setFontSize(8.5);
  doc.text(labels.description,16,y);doc.text(labels.quantity,112,y,{align:'right'});doc.text(labels.price,135,y,{align:'right'});doc.text(labels.vat,153,y,{align:'right'});doc.text(labels.total,194,y,{align:'right'});y+=7;doc.setFont('helvetica','normal');
  for(const line of invoice.lines){
    if(y>258){doc.addPage();y=20;}
    const description=doc.splitTextToSize(line.description,85);doc.text(description,16,y);doc.text(line.quantity.toLocaleString(locale),112,y,{align:'right'});doc.text(money(line.unitPrice),135,y,{align:'right'});doc.text(`${line.taxRate.toLocaleString(locale)} %`,153,y,{align:'right'});doc.text(money(line.lineTotal??0),194,y,{align:'right'});y+=Math.max(7,description.length*4.5+2);
  }

  if(y>250){doc.addPage();y=24;}else y+=4;
  doc.line(115,y,196,y);y+=7;doc.setFontSize(9);
  doc.text(`${labels.taxableBase}:`,150,y,{align:'right'});doc.text(money(invoice.subtotal),194,y,{align:'right'});y+=6;
  if(invoice.discountAmount!==0){doc.text(`${labels.discounts}:`,150,y,{align:'right'});doc.text(money(-invoice.discountAmount),194,y,{align:'right'});y+=6;}
  doc.text(`${labels.vat}:`,150,y,{align:'right'});doc.text(money(invoice.taxAmount),194,y,{align:'right'});y+=8;doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text(`${labels.total}:`,150,y,{align:'right'});doc.text(money(invoice.totalAmount),194,y,{align:'right'});

  const bank=invoice.bankAccountSnapshot;
  const showBank=Boolean(bank?.iban&&(salesSettings?.showIbanOnPdf??true));
  const legacyBank=invoice.bankSnapshotSource==='legacy_current_render';
  doc.setFont('helvetica','normal');doc.setFontSize(8.5);
  const bankLines=showBank&&!legacyBank?[`IBAN: ${bank!.iban}`,...(bank!.bic?[`BIC/SWIFT: ${bank!.bic}`]:[]),...(bank!.holder?[`Titular: ${bank!.holder}`]:[])].flatMap(value=>doc.splitTextToSize(value,180) as string[]):[];
  let footerY=Math.max(y+16,265-Math.max(0,bankLines.length-1)*5);
  if(footerY>278){doc.addPage();footerY=24;}
  if(invoice.paymentMethod&&(salesSettings?.showPaymentMethodOnPdf??true)){doc.text(`${labels.paymentMethod}: ${invoice.paymentMethod}`,14,footerY);footerY+=5;}
  if(bank?.iban&&(salesSettings?.showIbanOnPdf??true)&&invoice.bankSnapshotSource==='legacy_current_render'){
    doc.text(`IBAN: ${bank.iban}`,14,footerY);footerY+=5;
  }else if(bank?.iban&&(salesSettings?.showIbanOnPdf??true)){
    for(const line of bankLines){
      if(footerY>278){doc.addPage();footerY=24;}
      doc.text(line,14,footerY);footerY+=5;
    }
  }
  if(invoice.notes){doc.text(doc.splitTextToSize(`${labels.notes}: ${invoice.notes}`,180),14,footerY);footerY+=8;}
  if(settings?.invoiceFooter)doc.text(doc.splitTextToSize(settings.invoiceFooter,180),14,footerY);
  return doc.output('blob');
}

export function downloadSalesInvoicePdf(invoice:SalesInvoice,settings?:BusinessSettings|null,branding?:InvoicePdfBranding|null,salesSettings?:SalesSettings|null,generalSettings:GeneralSettings=DEFAULT_APP_SETTINGS.general){
  const blob=createSalesInvoicePdfBlob(invoice,settings,branding,salesSettings,generalSettings);
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=salesInvoicePdfFilename(invoice);document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function printSalesInvoicePdf(invoice:SalesInvoice,settings?:BusinessSettings|null,branding?:InvoicePdfBranding|null,salesSettings?:SalesSettings|null,generalSettings:GeneralSettings=DEFAULT_APP_SETTINGS.general){
  const blob=createSalesInvoicePdfBlob(invoice,settings,branding,salesSettings,generalSettings);
  const url=URL.createObjectURL(blob);const printWindow=window.open(url,'_blank','noopener,noreferrer');if(!printWindow){URL.revokeObjectURL(url);throw new Error('El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes para ZENVIA Gestión e inténtalo de nuevo.');}const cleanup=()=>window.setTimeout(()=>URL.revokeObjectURL(url),60000);printWindow.addEventListener('load',()=>{window.setTimeout(()=>{try{printWindow.focus();printWindow.print();}catch{}cleanup();},700);},{once:true});window.setTimeout(cleanup,65000);
}

