import type {ReactNode} from 'react';

export function PageHeader({title,eyebrow,description,actions}:{title:string;eyebrow?:ReactNode;description?:ReactNode;actions?:ReactNode}){
  return <header className="pageHead dsPageHeader">
    <div className="dsPageHeaderIdentity">{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>
    {actions&&<div className="dsPageHeaderActions" role="region" aria-label={`Acciones de ${title}`} tabIndex={0}>{actions}</div>}
  </header>;
}
