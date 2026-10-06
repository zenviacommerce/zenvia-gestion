import {useRef,type ReactNode} from 'react';
// Keep browser-based imports and reviews alive while navigating within the app.
// The caller keys this boundary by tenant and authenticated user.
export function RetainedImportPage({active,children}:{active:boolean;children:ReactNode}){
 const visited=useRef(false);if(active)visited.current=true;
 return visited.current?<div hidden={!active}>{children}</div>:null;
}
