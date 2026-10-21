export function installMasterPeriodFixture(){
 const products=Array.from({length:72},(_,i)=>({id:`product-${String(i+1).padStart(3,'0')}`,name:`Producto ${String(i+1).padStart(3,'0')}${i>=64?' · Sin actividad':''}`,sku:`DEMO-${String(i+1).padStart(3,'0')}`,category:i%2?'Embalaje':'Materiales',supplier:i%3?'Proveedor Norte':'Proveedor Sur',lastPrice:i<32?10:20,previousPrice:9,lastPurchaseDate:i<32?'2026-10-15':i<64?'2026-09-15':null,unit:'ud'}));
 globalThis.masterPeriodFixture={products,sales:new Map(products.map((p,i)=>[p.id,{salePrice:i%3?30:null,salesTaxRate:i%2?21:10,invoiceDescription:p.name,ean:`EAN${i+1}`}]))};
 globalThis.masterPeriodActions=[];
 globalThis.masterPeriodServices={loadProductSalesMap:async()=>globalThis.masterPeriodFixture.sales,showError:e=>{throw Error(e)},showSuccess:()=>{},confirmAction:async o=>{globalThis.masterPeriodActions.push({type:'confirmation',...o});return false},openActionProcess:()=>{throw Error('Unexpected mutation')}};
}
