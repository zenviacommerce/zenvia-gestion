import type {ReactNode} from 'react';
import {TableSortReset,type TableSortControls} from './SortableTableHeader';
/** Native React list ownership: observers must not inject row controls here. */
export function DataTable({label,children,sorting}:{label:string;children:ReactNode;sorting?:TableSortControls}){
 return <>{sorting&&<TableSortReset sorting={sorting}/>}<section className="card tableCard masterTableCard dsDataTable" data-native-list role="region" aria-label={label} tabIndex={0}>{children}</section></>;
}
export function MobileList({label,children}:{label:string;children:ReactNode}){
 return <div className="masterMobileList dsMobileList" data-native-list role="list" aria-label={label}>{children}</div>;
}
