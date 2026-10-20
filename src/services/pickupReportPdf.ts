import { jsPDF } from 'jspdf';
import type { PickupReport } from './pickupReports';

/** Deliberately renders an allowlist: recipient and buyer data never enter this document. */
export type PickupPdfOptions = {logoDataUrl?: string | null; generatedAt?: Date};

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
    let y = 0;
    const newPage = () => {
      if (!first) doc.addPage();
      first = false;
      doc.setTextColor(32, 41, 55); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
      doc.text('JUSTIFICANTE DE RECOGIDA', 14, 19);
      if (options.logoDataUrl) {
        try {
          const image = doc.getImageProperties(options.logoDataUrl);
          const scale = Math.min(35 / image.width, 14 / image.height);
          doc.addImage(options.logoDataUrl, undefined as any, 196 - image.width * scale, 10, image.width * scale, image.height * scale);
        } catch { /* A damaged optional logo must not prevent printing the saved receipt. */ }
      }
      doc.setFontSize(10); doc.text(lines(`Informe ${report.number} · ${carrier}`, 182), 14, 27);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(`Creado: ${created}   |   Generado: ${generated}`, 14, 35);
      const sender = [report.sender.legalName, `NIF: ${report.sender.taxId}`, report.sender.address,
        [report.sender.email, report.sender.phone].filter(Boolean).join(' · ')].filter(Boolean);
      y = 43;
      for (const part of sender) { const wrapped = lines(part, 180); doc.text(wrapped, 14, y); y += wrapped.length * 3.6; }
      y += 5;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(`Transportista: ${carrier}   |   Envíos: ${items.length}   |   Bultos: ${parcels}`, 14, y);
      y += 8;
      doc.setFillColor(245, 247, 249); doc.rect(14, y - 5, 182, 8, 'F');
      doc.setFontSize(8); doc.text('Pedido / canal', 16, y); doc.text('Seguimiento', 75, y); doc.text('Bultos', 193, y, { align: 'right' });
      doc.setFont('helvetica', 'normal'); y += 8;
    };
    newPage();
    for (const item of items) {
      doc.setFontSize(9);
      const channel = ({amazon: 'Amazon', shopify: 'Shopify'} as Record<string, string>)[item.channel.toLowerCase()] || item.channel;
      const order = [...lines(item.orderNumber, 52), ...lines(channel, 52)];
      const tracking = lines(item.trackingNumber || 'Sin seguimiento', 97);
      let offset = 0;
      const count = Math.max(order.length, tracking.length);
      while (offset < count) {
        const room = Math.floor((260 - y - 5) / 4.2);
        if (room < 1) { newPage(); continue; }
        const take = Math.min(room, count - offset);
        // Explicit baselines share the same metrics as pagination and separators.
        doc.setFontSize(9);
        order.slice(offset, offset + take).forEach((line, i) => doc.text(line, 16, y + i * 4.2));
        tracking.slice(offset, offset + take).forEach((line, i) => doc.text(line, 75, y + i * 4.2));
        if (!offset) doc.text(String(item.packages), 193, y, { align: 'right' });
        const ruleY = y + (take - 1) * 4.2 + 3;
        doc.setDrawColor(225); doc.line(14, ruleY, 196, ruleY);
        y = ruleY + 5;
        offset += take;
        if (offset < count) newPage();
      }
    }
    if (y + 88 > 274) newPage();
    y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(`TOTAL RECOGIDO · ${carrier}: ${parcels} bultos / ${items.length} envíos`, 14, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); y += 10;
    doc.text('Conductor/a: ___________________________________________________', 14, y); y += 9;
    doc.text('DNI / matrícula: __________________', 14, y); y += 8;
    doc.text('Fecha y hora de recogida: _______________________________________', 14, y); y += 8;
    doc.text(`Total de bultos entregados: ${parcels}`, 14, y); y += 9;
    doc.text('Firma del conductor/a', 14, y); doc.text('Firma / sello del remitente', 110, y);
    y += 3; doc.setDrawColor(100); doc.setLineWidth(0.3);
    doc.rect(14, y, 82, 30); doc.rect(110, y, 86, 30);
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
  let logoDataUrl: string | null | undefined;
  try { logoDataUrl = (await (await import('./companyBranding')).loadCompanyBranding()).logoDataUrl; } catch { /* Optional branding: preserve a printable text header. */ }
  if (client !== getActiveSupabase() || workspace !== getActiveTenant()?.workspace_id) throw new Error('La empresa o sesión ha cambiado. Vuelve a abrir el informe.');
  const url = URL.createObjectURL(createPickupReportPdfBlob(report, {logoDataUrl}));
  const link = document.createElement('a'); link.href = url; link.download = pickupReportPdfFilename(report);
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
