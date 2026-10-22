import {jsPDF} from 'jspdf';
import type {PickupReport} from './pickupReports';
import {createPickupReportDocument,type PickupPdfOptions} from '../../supabase/functions/_shared/pickupReportDocument';
export type {PickupPdfOptions} from '../../supabase/functions/_shared/pickupReportDocument';
/** Deliberately renders an allowlist: buyer data never enters this document. */
export function createPickupReportPdfBlob(report:PickupReport,options:PickupPdfOptions={}):Blob{
 const bytes=createPickupReportDocument(report,()=>new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true}),options);
 return new Blob([new Uint8Array(bytes).buffer],{type:'application/pdf'});
}

export function pickupReportPdfFilename(report: PickupReport): string {
  return `${report.number.replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`;
}

export async function downloadPickupReportPdf(report: PickupReport): Promise<void> {
  const {getActiveSupabase, getActiveTenant} = await import('./supabase');
  const client = getActiveSupabase(), workspace = getActiveTenant()?.workspace_id;
  // Always resolve current server state. A creation snapshot may have been signed
  // in this dialog, another tab or another user's session since it was fetched.
  const {getPickupDocumentPdf}=await import('./pickupReportDocuments');
  const blob=await getPickupDocumentPdf(report.id);
  if(client!==getActiveSupabase()||workspace!==getActiveTenant()?.workspace_id)throw Error('La empresa o sesión ha cambiado. Vuelve a abrir el informe.');
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=pickupReportPdfFilename(report);document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
