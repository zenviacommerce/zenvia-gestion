import type {ImportJob,ImportItem,ImportOutcome} from '../../../../shared/imports/contracts.ts';
import {executeDocument} from './documentEngine.ts';
import {executeGmailDocument,scanGmailPage} from './gmailAdapter.ts';
import {executeShopify} from './shopifyAdapter.ts';
import {executeEnvia} from './orderAdapters.ts';
export async function executeImport(admin:any,job:ImportJob,item:ImportItem):Promise<ImportOutcome&{committed?:boolean}>{
 switch(job.kind){
  case 'gmail_scan':return scanGmailPage(admin,job,item);
  case 'expense_document':return item.input.gmailId?executeGmailDocument(admin,job,item):executeDocument(admin,job,item);
  case 'sales_document':case 'transport_tariff':return executeDocument(admin,job,item);
  case 'shopify_orders':return executeShopify(admin,job,item);
  case 'envia_shipments':return executeEnvia(admin,job,item);
  case 'sendcloud_orders':return {status:'skipped',stage:'Los pedidos se importan por los canales directos de Amazon y Shopify.'};
 }
}
