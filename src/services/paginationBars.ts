// Mirror existing pagination by forwarding actions to its original controller.
// Native/server pagination remains the sole owner of page state and data fetching.
const selector='.listPagination,.gmailPagination,.amazonPagination';
const mirrors=new Map<HTMLElement,{top:HTMLElement;anchor:HTMLElement;signature:string}>();
export function mirrorPaginationBars(){
 for(const [source,entry] of mirrors)if(!source.isConnected||!entry.anchor.isConnected){entry.top.remove();mirrors.delete(source);}
 document.querySelectorAll<HTMLElement>(selector).forEach(source=>{
  if(source.classList.contains('paginationMirror'))return;
  const pageMatch=source.textContent?.match(/Página\s+\d+\s+de\s+(\d+)/i);
  const buttonsForPages=Array.from(source.querySelectorAll<HTMLButtonElement>('button'));
  const singlePage=pageMatch?Number(pageMatch[1])<=1:buttonsForPages.length>=2&&buttonsForPages.every(button=>button.disabled);
  source.hidden=singlePage;
  if(singlePage){mirrors.get(source)?.top.remove();mirrors.delete(source);return;}
  let anchor=source.closest<HTMLElement>('.tableCard,.gmailImports,.amazonTableCard');
  if(!anchor){let previous=source.previousElementSibling;while(previous){if(previous.matches('.tableCard')||previous.querySelector('table')){anchor=previous as HTMLElement;break;}previous=previous.previousElementSibling;}}
  anchor=anchor||source.closest<HTMLElement>('.card')||source.previousElementSibling as HTMLElement|null;
  if(!anchor||anchor===source||!anchor.parentElement)return;
  let entry=mirrors.get(source);
  if(!entry||entry.anchor!==anchor){entry?.top.remove();const top=document.createElement('div');anchor.before(top);entry={top,anchor,signature:''};mirrors.set(source,entry);}
  // React can move a retained table without unmounting its footer.
  if(entry.top.nextElementSibling!==anchor)anchor.before(entry.top);
  const signature=source.outerHTML;
  if(entry.signature===signature)return;
  const buttons=Array.from(entry.top.querySelectorAll('button')),focusIndex=buttons.indexOf(document.activeElement as HTMLButtonElement);
  entry.top.className=source.className+' paginationMirror';entry.top.setAttribute('aria-label','Paginación superior');
  entry.top.innerHTML=source.innerHTML;entry.signature=signature;
  entry.top.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
  entry.top.querySelectorAll<HTMLButtonElement>('button').forEach((button,index)=>{button.type='button';button.onclick=()=>source.querySelectorAll<HTMLButtonElement>('button')[index]?.click();});
  if(focusIndex>=0)entry.top.querySelectorAll<HTMLButtonElement>('button')[focusIndex]?.focus({preventScroll:true});
 });
}
export function clearPaginationMirrors(){for(const {top} of mirrors.values())top.remove();mirrors.clear();}
