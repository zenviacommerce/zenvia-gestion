export async function updateSalesInvoiceNumber(_invoiceId:string,_invoiceNumber:string):Promise<never>{
  throw new Error('El número de factura se asigna al emitir y no se puede modificar manualmente.');
}
