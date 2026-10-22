import {getActiveSupabase,getActiveTenant} from './supabase';
import {fetchMatchingOrderIds,type OrdersDashboardFilters} from './orders';
import type {PickupDocumentStatus} from './pickupReportDocuments';
export type PickupReportItem={orderId:string;orderNumber:string;channel:string;carrier:string;trackingNumber:string;packages:number;eligible:boolean;issue?:string|null;previousReports:string[];packageCountEstimated?:boolean;packagesSource?:string};
export type PickupReport={id:string;number:string;createdAt:string;createdBy:string;sender:{legalName:string;taxId:string;address:string;email:string;phone:string};items:Array<Omit<PickupReportItem,'eligible'|'issue'|'previousReports'>>;totalPackages:number;document?:PickupDocumentStatus};
export type PickupReportSummary=Pick<PickupReport,'id'|'number'|'createdAt'|'totalPackages'>&{totalOrders?:number;carriers?:string[];document?:PickupDocumentStatus};
export type PickupPreview={items:PickupReportItem[];totalPackages:number;canCreate:boolean};
async function rpc<T>(name:string,params:Record<string,unknown>):Promise<T>{
 const client=getActiveSupabase(),workspace=getActiveTenant()?.workspace_id;
 const {data,error}=await client.rpc(name,params).abortSignal(AbortSignal.timeout(15000));
 if(client!==getActiveSupabase()||workspace!==getActiveTenant()?.workspace_id)throw new Error('La empresa o sesión ha cambiado. Vuelve a abrir el informe.');
 if(error){const messages:Record<string,string>={PICKUP_ALREADY_REPORTED:'Algún pedido ya figura en otro informe. Revisa los anteriores y confirma si procede.',PICKUP_INELIGIBLE_ORDERS:'La etiqueta o el seguimiento de algún pedido ha cambiado. Cierra y revisa de nuevo.',PICKUP_SENDER_REQUIRED:'Completa los datos de tu empresa en Configuración → General antes de generar el informe.',PICKUP_ORDERS_UNAVAILABLE:'No se puede acceder a todos los pedidos seleccionados.',PICKUP_DUPLICATE_SELECTION:'La selección contiene un pedido repetido. Actualiza y vuelve a seleccionar.',PICKUP_REQUEST_REUSED:'La solicitud ya se guardó con otros datos. Cierra y consulta el historial antes de repetir.',PICKUP_INVALID_PACKAGES:'Revisa los bultos: deben ser enteros entre 1 y 100.'};throw new Error(messages[error.message]||error.message||'No se pudo completar el informe.');}return data as T;
}
function validIds(ids:string[]){if(!ids.length||ids.length>2000||new Set(ids).size!==ids.length)throw new Error('Selecciona entre 1 y 2.000 pedidos distintos.');}
export async function previewPickupReport(ids:string[]){validIds(ids);return rpc<PickupPreview>('pickup_report_preview',{p_order_ids:ids});}
export async function createPickupReport(ids:string[],requestId:string,allowDuplicates:boolean,counts:Record<string,number>){validIds(ids);return rpc<PickupReport>('pickup_report_create',{p_order_ids:ids,p_request_id:requestId,p_allow_duplicates:allowDuplicates,p_package_counts:counts});}
export async function createPickupReports(ids:string[],requestId:string,allowDuplicates:boolean,counts:Record<string,number>){validIds(ids);return rpc<PickupReport[]>('pickup_report_create_batch',{p_order_ids:ids,p_request_id:requestId,p_allow_duplicates:allowDuplicates,p_package_counts:counts});}
export async function listPickupReports(orderId:string|null=null,includeDocuments=false){
 const client=getActiveSupabase(),workspace=getActiveTenant()?.workspace_id,rows=await rpc<PickupReportSummary[]>('pickup_report_list',{p_order_id:orderId,p_limit:50});if(!includeDocuments||!rows.length)return rows;
 const {getPickupDocumentStatuses}=await import('./pickupReportDocuments'),states=await getPickupDocumentStatuses(rows.map(row=>row.id));
 if(client!==getActiveSupabase()||workspace!==getActiveTenant()?.workspace_id)throw Error('La empresa o sesión ha cambiado. Vuelve a abrir los informes.');
 return rows.map(row=>({...row,document:states.find(state=>state.id===row.id)}));
}
export async function getPickupReport(reportId:string){
 const client=getActiveSupabase(),workspace=getActiveTenant()?.workspace_id,report=await rpc<PickupReport>('pickup_report_get',{p_report_id:reportId});
 const {getPickupDocumentStatuses}=await import('./pickupReportDocuments'),states=await getPickupDocumentStatuses([reportId]);
 if(client!==getActiveSupabase()||workspace!==getActiveTenant()?.workspace_id)throw Error('La empresa o sesión ha cambiado. Vuelve a abrir el informe.');return {...report,document:states[0]};
}
export async function selectPickupOrderIds(filters:OrdersDashboardFilters){
 return fetchMatchingOrderIds(filters,true);
}
