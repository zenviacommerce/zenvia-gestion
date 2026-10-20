export function OrderProductLines({lines,limit=3}:{lines:Array<{name:string;quantity:number}>;limit?:number}){
 const shown=lines.slice(0,limit),remaining=lines.slice(limit);
 const label=(line:typeof lines[number])=>`${line.name} ×${line.quantity}`;
 return <div className="ordersProductLines">{shown.map((line,index)=><strong className="ordersProductLine" aria-label={label(line)} key={index}><span className="ordersProductName">{line.name}</span><span className="ordersProductQuantity">×{line.quantity}</span></strong>)}{remaining.length>0&&<span className="ordersProductMore" tabIndex={0} title={remaining.map(label).join('\n')} data-zenvia-tooltip={remaining.map(label).join('\n')}>+{remaining.length} más</span>}</div>;
}
