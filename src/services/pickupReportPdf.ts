import { jsPDF } from 'jspdf';
import type { PickupReport } from './pickupReports';

/** Deliberately renders an allowlist: recipient and buyer data never enter this document. */
export type PickupPdfOptions = {logoDataUrl?: string | null; stampDataUrl?: string | null; generatedAt?: Date};

export function createPickupReportPdfBlob(report: PickupReport, options: PickupPdfOptions = {}): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  const groups = new Map<string, PickupReport['items']>();
  for (const item of report.items) {
    const carrier = item.carrier.trim() || 'Sin transportista';
    groups.set(carrier, [...(groups.get(carrier) || []), item]);
  }
  if (!groups.size) throw new Error('El informe no contiene envíos.');
  const date = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });
  const generated = `${date.format(options.generatedAt ?? new Date())} (Europe/Madrid)`;
  const created = date.format(new Date(report.createdAt));
  const lines = (value: unknown, width: number): string[] => doc.splitTextToSize(String(value ?? ''), width);
  let first = true;
  for (const [carrier, items] of groups) {
    const parcels = items.reduce((sum, item) => sum + item.packages, 0);
    const left = 12, right = 198, bodyBottom = 274, lineHeight = 3.5, signatureHeight = 48;
    let y = 0;
    const newPage = () => {
      if (!first) doc.addPage();
      first = false;
      doc.setTextColor(32, 41, 55);
      if (options.logoDataUrl) {
        try {
          const image = doc.getImageProperties(options.logoDataUrl);
          const scale = Math.min(23 / image.width, 15 / image.height);
          doc.addImage(options.logoDataUrl, undefined as any, left, 9, image.width * scale, image.height * scale);
        } catch { /* A damaged optional logo must not prevent printing the saved receipt. */ }
      }
      const senderX = options.logoDataUrl ? 40 : left;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      const nameLines = lines(`${report.sender.legalName} · NIF: ${report.sender.taxId}`, right - senderX);
      doc.text(nameLines, senderX, 12);
      const senderY = 16 + Math.max(0, nameLines.length - 1) * 3.7;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      const sender = [report.sender.address, [report.sender.email, report.sender.phone].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
      const senderLines = lines(sender, right - senderX);
      doc.text(senderLines, senderX, senderY);
      const titleY = Math.max(26, senderY + 2 + senderLines.length * 3.3);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('JUSTIFICANTE DE RECOGIDA', left, titleY);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.text(`Generado: ${generated}`, right, titleY, {align: 'right'});
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      const summary = lines(`Informe ${report.number} · Transportista: ${carrier} · Creado: ${created} · Envíos: ${items.length} · Bultos: ${parcels}`, right - left - 4);
      const stripY = titleY + 3, stripHeight = summary.length * 3.5 + 3;
      doc.setFillColor(240, 243, 246); doc.rect(left, stripY, right - left, stripHeight, 'F');
      doc.text(summary, left + 2, stripY + 3.7);
      y = stripY + stripHeight + 4;
      doc.setFontSize(8);
      doc.text('Pedido · canal', left + 2, y); doc.text('Seguimiento', 77, y); doc.text('Bultos', right - 2, y, {align: 'right'});
      doc.setDrawColor(190); doc.setLineWidth(0.15); doc.line(left, y + 1.7, right, y + 1.7);
      y += 5;
    };
    newPage();
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const channel = ({amazon: 'Amazon', shopify: 'Shopify'} as Record<string, string>)[item.channel.toLowerCase()] || item.channel;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      const order = lines(`${item.orderNumber} · ${channel}`, 59);
      doc.setFont('courier', 'normal');
      const tracking = lines(item.trackingNumber || 'Sin seguimiento', 112);
      const count = Math.max(order.length, tracking.length);
      const rowHeight = count * lineHeight + 1.5;
      const isLast = index === items.length - 1;
      // The last shipment travels with the signature block, never leaving a signature-only page.
      if (rowHeight <= 180 && y + rowHeight + (isLast ? signatureHeight : 0) > bodyBottom) newPage();
      let offset = 0;
      while (offset < count) {
        let room = Math.floor((bodyBottom - y - 1.5) / lineHeight);
        if (isLast && count - offset <= room && y + (count - offset) * lineHeight + 1.5 + signatureHeight > bodyBottom) {
          const roomWithSignatures = Math.floor((bodyBottom - y - 1.5 - signatureHeight) / lineHeight);
          // Preserve a final fragment on the signature page for exceptionally long identifiers.
          room = Math.min(room, Math.max(0, count - offset - Math.max(1, roomWithSignatures)));
        }
        if (room < 1) { newPage(); continue; }
        const take = Math.min(room, count - offset);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        order.slice(offset, offset + take).forEach((line, i) => doc.text(line, left + 2, y + i * lineHeight));
        doc.setFont('courier', 'normal');
        tracking.slice(offset, offset + take).forEach((line, i) => doc.text(line, 77, y + i * lineHeight));
        doc.setFont('helvetica', 'normal');
        if (!offset) doc.text(String(item.packages), right - 2, y, {align: 'right'});
        const ruleY = y + (take - 1) * lineHeight + 1.8;
        doc.setDrawColor(225); doc.setLineWidth(0.1); doc.line(left, ruleY, right, ruleY);
        y += take * lineHeight + 1.5;
        offset += take;
        if (offset < count) newPage();
      }
    }
    y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(`TOTAL RECOGIDO · ${carrier}: ${parcels} bultos / ${items.length} envíos`, left, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); y += 5;
    doc.text('Conductor/a: __________________________________    DNI / matrícula: __________________', left, y); y += 5;
    doc.text('Fecha y hora de recogida: ________________________________________________________', left, y); y += 5;
    doc.text('Firma del conductor/a', left, y); doc.text('Firma / sello del remitente', 110, y);
    y += 2; doc.setDrawColor(100); doc.setLineWidth(0.2);
    doc.rect(left, y, 60, 25); doc.rect(110, y, 60, 25);
    if (options.stampDataUrl) {
      try {
        const image = doc.getImageProperties(options.stampDataUrl);
        const scale = Math.min(56 / image.width, 21 / image.height);
        const width = image.width * scale, height = image.height * scale;
        doc.addImage(options.stampDataUrl, undefined as any, 110 + (60 - width) / 2, y + (25 - height) / 2, width, height);
      } catch { /* An optional stamp must never block a printable report. */ }
    }
  }
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
    doc.text(`Informe ${report.number}`, 14, 286);
    doc.text(`Página ${page} de ${total}`, 196, 286, { align: 'right' });
  }
  return doc.output('blob');
}

export function pickupReportPdfFilename(report: PickupReport): string {
  return `${report.number.replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`;
}

export async function downloadPickupReportPdf(report: PickupReport): Promise<void> {
  const {getActiveSupabase, getActiveTenant} = await import('./supabase');
  const client = getActiveSupabase(), workspace = getActiveTenant()?.workspace_id;
  let logoDataUrl: string | null | undefined, stampDataUrl: string | null | undefined;
  try { const branding=await (await import('./companyBranding')).loadCompanyBranding();logoDataUrl=branding.logoDataUrl;stampDataUrl=branding.stampDataUrl; } catch { /* Optional branding: preserve a printable text header. */ }
  if (client !== getActiveSupabase() || workspace !== getActiveTenant()?.workspace_id) throw new Error('La empresa o sesión ha cambiado. Vuelve a abrir el informe.');
  const url = URL.createObjectURL(createPickupReportPdfBlob(report, {logoDataUrl,stampDataUrl}));
  const link = document.createElement('a'); link.href = url; link.download = pickupReportPdfFilename(report);
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
