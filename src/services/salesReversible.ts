import {deleteSalesInvoiceDraftSafe} from './salesDraftDelete';

export async function reopenSalesInvoice(_id:string):Promise<never>{
  throw new Error('Las facturas emitidas no se pueden reabrir. Crea una rectificativa.');
}

export async function deleteReversibleSalesInvoice(id:string){
  return deleteSalesInvoiceDraftSafe(id);
}
