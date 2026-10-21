// The approved Products period correction clarifies two labels; numeric values
// and every other KPI remain subject to the existing equality comparison.
export function masterKpiTexts(screen,cards){
 return cards.map(card=>{
  const text=card.text.replace(/\s+/g,' ').trim();
  return screen==='products'?text.replace(/^Productos visibles(?=\s|\d|$)/,'Productos en periodo').replace(/^(Con precio de venta\s*\d+\s*)de (\d+) visibles$/,'$1de $2 en el periodo'):text;
 });
}
