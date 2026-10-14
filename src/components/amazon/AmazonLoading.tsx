import { LoaderCircle } from 'lucide-react';

export function AmazonLoading({children}:{children:string}){
  return <div className="amazonInlineLoading" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true"/><span>{children}</span></div>;
}
