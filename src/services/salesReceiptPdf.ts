import jsPDF from 'jspdf';
import type { BusinessSettings } from './sales';
import type { SalesReceipt } from './salesReceipts';
import type { CompanyBranding } from './companyBranding';
import { DEFAULT_APP_SETTINGS, type GeneralSettings } from './settingsSchema';
import { formatAppDate, formatAppMoney } from './formatting';

function addLogo(doc:jsPDF,logoDataUrl?:string|null){
  if(!logoDataUrl)return 0;
  try{
    const image=doc.getImageProperties(logoDataUrl);
    const maxWidth=50,maxHeight=18,ratio=image.width/image.height;
    let width=maxWidth,height=width/ratio;
    if(height>maxHeight){height=maxHeight;width=height*ratio;}
    doc.addImage(logoDataUrl,undefined as any,14,11,width,height,undefined,'FAST');
    return height;
  }catch{return 0;}
}

export function salesReceiptPdfFilename(receipt:SalesReceipt){
  return `${receipt.receiptNumber.replace(/[^A-Za-z0-9_-]+/g,'_')}.pdf`;
}

export function createSalesReceiptPdfBlob(
  receipt:SalesReceipt,
  business?:BusinessSettings|null,
  branding?:CompanyBranding|null,
  general:GeneralSettings=DEFAULT_APP_SETTINGS.general,
){
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const money=(value:number)=>formatAppMoney(value,receipt.currency,general,{minimumFractionDigits:2,maximumFractionDigits:2});
  const issuer=business?.tradeName||business?.legalName||'ZENVIA COMMERCE SL';
  const logoHeight=addLogo(doc,branding?.logoDataUrl);
  let y=logoHeight?14+logoHeight+5:18;
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text(issuer,14,y);
  y+=5;doc.setFont('helvetica','normal');doc.setFontSize(8.5);
  const address=[business?.addressLine1,business?.addressLine2,[business?.postalCode,business?.city].filter(Boolean).join(' '),business?.province].filter(Boolean).join(', ');
  if(address){doc.text(doc.splitTextToSize(address,95),14,y);y+=8;}
  doc.setFont('helvetica','bold');doc.setFontSize(17);doc.text('RECIBO INTERNO',196,18,{align:'right'});
  doc.setFontSize(11);doc.text(receipt.receiptNumber,196,26,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(`Fecha: ${formatAppDate(receipt.receiptDate,general,'')}`,196,33,{align:'right'});
  doc.setDrawColor(210);doc.line(14,Math.max(52,y+4),196,Math.max(52,y+4));
  y=Math.max(60,y+12);
  doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('CLIENTE',14,y);y+=7;
  doc.setFontSize(10);doc.text(receipt.clientName,14,y);y+=10;
  doc.setFillColor(245,247,249);doc.rect(14,y-5,182,8,'F');doc.setFontSize(8.5);
  doc.text('Descripción',16,y);doc.text('Cant.',120,y,{align:'right'});doc.text('Precio',151,y,{align:'right'});doc.text('Importe',194,y,{align:'right'});y+=7;
  doc.setFont('helvetica','normal');
  for(const line of receipt.lines){
    if(y>260){doc.addPage();y=20;}
    const description=doc.splitTextToSize(line.description,88);
    doc.text(description,16,y);
    doc.text(line.quantity.toLocaleString('es-ES'),120,y,{align:'right'});
    doc.text(money(line.unitPrice),151,y,{align:'right'});
    doc.text(money(line.lineTotal??(line.quantity*line.unitPrice*(1-(line.discountPercent||0)/100))),194,y,{align:'right'});
    y+=Math.max(7,description.length*4.5+2);
  }
  y+=5;doc.line(125,y,196,y);y+=9;
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.text('Pendiente (sin IVA):',160,y,{align:'right'});doc.text(money(receipt.totalAmount),194,y,{align:'right'});
  y+=15;doc.setFont('helvetica','normal');doc.setFontSize(8.5);
  doc.setTextColor(90);
  doc.text(doc.splitTextToSize('Documento interno de control de entregas pendientes de facturar. No es una factura ni sustituye a la factura correspondiente. El IVA no se desglosa en este documento y se calculará al emitir la factura.',180),14,y);
  y+=16;
  if(receipt.notes){doc.setTextColor(40);doc.text(doc.splitTextToSize(`Notas: ${receipt.notes}`,180),14,y);}
  return doc.output('blob');
}

export function downloadSalesReceiptPdf(receipt:SalesReceipt,business?:BusinessSettings|null,branding?:CompanyBranding|null,general:GeneralSettings=DEFAULT_APP_SETTINGS.general){
  const blob=createSalesReceiptPdfBlob(receipt,business,branding,general);
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=salesReceiptPdfFilename(receipt);document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function printSalesReceiptPdf(receipt:SalesReceipt,business?:BusinessSettings|null,branding?:CompanyBranding|null,general:GeneralSettings=DEFAULT_APP_SETTINGS.general){
  const blob=createSalesReceiptPdfBlob(receipt,business,branding,general);
  const url=URL.createObjectURL(blob);const printWindow=window.open(url,'_blank','noopener,noreferrer');
  if(!printWindow){URL.revokeObjectURL(url);throw new Error('El navegador ha bloqueado la ventana de impresión.');}
  const cleanup=()=>window.setTimeout(()=>URL.revokeObjectURL(url),60000);
  printWindow.addEventListener('load',()=>window.setTimeout(()=>{try{printWindow.focus();printWindow.print();}catch{}cleanup();},600),{once:true});
  window.setTimeout(cleanup,65000);
}
