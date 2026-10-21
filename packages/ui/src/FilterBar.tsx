import type {ReactNode} from 'react';
// Layout only: fields retain their original state, labels and handlers.
export function FilterBar({label,children,className=''}:{label:string;children:ReactNode;className?:string}){
 return <section className={`dsFilterBar ${className}`.trim()} aria-label={label}>{children}</section>;
}
