import {createContext,useContext,useEffect,useRef,useState,type ReactNode,type Dispatch,type SetStateAction} from 'react';
const PageActiveContext=createContext(true);
// Keep browser-based imports and reviews alive while navigating within the app.
// The caller keys this boundary by tenant and authenticated user.
export function RetainedImportPage({active,children}:{active:boolean;children:ReactNode}){
 const parentActive=useContext(PageActiveContext);
 const visited=useRef(false);if(active)visited.current=true;
 return visited.current?<PageActiveContext.Provider value={active&&parentActive}><div hidden={!active}>{children}</div></PageActiveContext.Provider>:null;
}

// Reset only filter state when revisiting a retained screen with memory disabled.
// Import progress, drafts and review state remain mounted and untouched.
export function useFilterState<T>(initialValue:T|(()=>T),rememberFilters:boolean):[T,Dispatch<SetStateAction<T>>]{
 const active=useContext(PageActiveContext);
 const [value,setValue]=useState<T>(initialValue);
 const initial=useRef(initialValue);initial.current=initialValue;
 const previous=useRef({active,rememberFilters});
 useEffect(()=>{
  if(!rememberFilters&&(previous.current.rememberFilters||(active&&!previous.current.active))){
   const next=initial.current;
   setValue(typeof next==='function'?(next as ()=>T)():next);
  }
  previous.current={active,rememberFilters};
 },[active,rememberFilters]);
 return [value,setValue];
}
