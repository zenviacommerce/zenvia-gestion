import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';
export function ProductIdentity({name,imageUrl,children}:{name:string;imageUrl?:string|null;children?:ReactNode}){
 return <div className="amazonProductIdentity channelProductIdentity">{imageUrl?<img className="amazonProductThumb" src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="amazonProductThumb amazonProductThumbPlaceholder"><ImageOff size={18}/></span>}<div><span className="channelProductName" data-zenvia-tooltip={name}>{name}</span>{children}</div></div>;
}
