import {useEffect,useRef,type RefObject} from 'react';
/** Trap only the active modal; nested report views make their parent inert. */
export function useFormDialog(root:RefObject<HTMLElement|null>,onClose:()=>void,enabled=true,labelledBy?:string){
 const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{if(!enabled)return;const origin=document.activeElement as HTMLElement|null,el=root.current;if(!el)return;
 const surface=el.querySelector<HTMLElement>('.modal')||el;surface.setAttribute('role','dialog');surface.setAttribute('aria-modal','true');if(labelledBy)surface.setAttribute('aria-labelledby',labelledBy);
 const controls=()=>[...el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length&&!node.closest('[inert]'));
 controls()[0]?.focus();const key=(event:KeyboardEvent)=>{if(event.defaultPrevented)return;if(event.key==='Escape'){event.preventDefault();close.current()}else if(event.key==='Tab'){const items=controls(),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}};
 document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(origin?.isConnected)origin.focus()};
 },[enabled,root,labelledBy]);
}
