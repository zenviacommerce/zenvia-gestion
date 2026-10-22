export type OrdersTab='pending'|'labelled'|'shipped'|'issues'|'cancelled'|'reports'|'all';
export const ORDERS_TABS:ReadonlyArray<{id:OrdersTab;label:string}>=[{id:'pending',label:'Pendientes'},{id:'labelled',label:'Etiquetados'},{id:'shipped',label:'Enviados'},{id:'issues',label:'Incidencias'},{id:'cancelled',label:'Cancelados'},{id:'reports',label:'Informes de recogida'}];
export function isOrdersTab(value:unknown):value is OrdersTab{return value==='all'||ORDERS_TABS.some(tab=>tab.id===value)}
export function parseOrdersTab(search:string):OrdersTab|null{
 const params=new URLSearchParams(search),tab=params.get('tab');
 return params.get('page')==='orders'&&isOrdersTab(tab)?tab:null;
}
export function ordersTabUsesPeriod(tab:OrdersTab){return tab==='shipped'||tab==='cancelled'}
export function ordersTabActions(tab:OrdersTab){return {labels:tab==='pending'||tab==='all',pickup:tab==='labelled'||tab==='shipped'||tab==='all'}}
export function ordersTabUrl(url:string,tab:OrdersTab){
 const next=new URL(url);next.searchParams.set('page','orders');next.searchParams.set('tab',tab);
 return next.pathname+next.search+next.hash;
}

export function ordersEntryPage(search:string,allowedPages:readonly string[]):'orders'|null{
 return new URLSearchParams(search).get('page')==='orders'&&allowedPages.includes('orders')?'orders':null;
}
