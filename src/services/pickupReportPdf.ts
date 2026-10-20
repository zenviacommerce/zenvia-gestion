import { jsPDF } from 'jspdf';
import type { PickupReport } from './pickupReports';

/** Deliberately renders an allowlist: recipient and buyer data never enter this document. */
export function createPickupReportPdfBlob(report: PickupReport): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const groups = new Map<string, PickupReport['items']>();
  for (const item of report.items) {
    const carrier = item.carrier.trim() || 'Sin transportista';
    groups.set(carrier, [...(groups.get(carrier) || []), item]);
  }
  if (!groups.size) throw new Error('El informe no contiene envíos.');
  const date = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });
  const generated = `${date.format(new Date())} (Europe/Madrid)`;
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
      const order = [...lines(item.orderNumber, 54), ...lines(item.channel, 54)];
      const tracking = lines(item.trackingNumber || 'Sin seguimiento', 99);
      let offset = 0;
      const count = Math.max(order.length, tracking.length);
      while (offset < count) {
        const room = Math.floor((260 - y - 4) / 4.2);
        if (room < 1) { newPage(); continue; }
        const take = Math.min(room, count - offset);
        doc.text(order.slice(offset, offset + take), 16, y);
        doc.text(tracking.slice(offset, offset + take), 75, y);
        if (!offset) doc.text(String(item.packages), 193, y, { align: 'right' });
        y += take * 4.2 + 4;
        doc.setDrawColor(225); doc.line(14, y - 2, 196, y - 2);
        offset += take;
        if (offset < count) newPage();
      }
    }
    if (y + 76 > 270) newPage();
    y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(`TOTAL RECOGIDO · ${carrier}: ${parcels} bultos / ${items.length} envíos`, 14, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); y += 10;
    doc.text('Conductor/a: ___________________________________________________', 14, y); y += 9;
    doc.text('DNI / matrícula: __________________    Fecha y hora: __________________', 14, y); y += 9;
    doc.text(`Total de bultos entregados: ${parcels}`, 14, y); y += 9;
    doc.text('Firma del conductor/a', 14, y); doc.text('Firma / sello del remitente', 110, y);
    y += 25; doc.line(14, y, 96, y); doc.line(110, y, 196, y);
  }
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
    doc.text(`Informe ${report.number}`, 14, 286);
    doc.text(`Página ${page} / ${total}`, 196, 286, { align: 'right' });
  }
  return doc.output('blob');
}

export function pickupReportPdfFilename(report: PickupReport): string {
  return `${report.number.replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`;
}

export function downloadPickupReportPdf(report: PickupReport): void {
  const url = URL.createObjectURL(createPickupReportPdfBlob(report));
  const link = document.createElement('a'); link.href = url; link.download = pickupReportPdfFilename(report);
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
