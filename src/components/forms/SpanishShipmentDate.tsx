import {useId,useState} from 'react';

// A native date input follows the browser locale, ignoring lang in Chromium.
// Keep the visible input and calendar explicitly Spanish in every browser.
export function SpanishShipmentDate({value,onChange,disabled}:{value:string;onChange:(value:string)=>void;disabled:boolean}){
 const id=useId(),[open,setOpen]=useState(false),[month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
 const parts=value.split(' '),date=parts[0]||'',time=parts[1]||'00:00';
 const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate(),offset=(month.getDay()+6)%7;
 const title=month.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
 return <div className="shipmentDate" lang="es-ES">
  <label htmlFor={id}>Fecha de envío (opcional)</label>
  <div className="shipmentDateInput"><input id={id} aria-label="Fecha de envío (opcional)" placeholder="dd/mm/aaaa" inputMode="numeric" maxLength={10} value={date} disabled={disabled} onChange={e=>onChange(e.target.value+(e.target.value?' '+time:''))}/><button type="button" className="secondary" aria-label="Abrir calendario de envío" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(!open)}>Calendario</button></div>
  {open&&<div className="shipmentCalendar" role="group" aria-label="Calendario de envío"><div className="shipmentCalendarHead"><button type="button" disabled={disabled} aria-label="Mes anterior" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}>‹</button><strong>{title}</strong><button type="button" disabled={disabled} aria-label="Mes siguiente" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}>›</button></div><div className="shipmentCalendarDays">{['L','M','X','J','V','S','D'].map(d=><span key={d}>{d}</span>)}{Array.from({length:offset},(_,i)=><span key={'empty'+i}/>)}{Array.from({length:count},(_,i)=>{const day=String(i+1).padStart(2,'0')+'/'+String(month.getMonth()+1).padStart(2,'0')+'/'+month.getFullYear();return <button type="button" key={i} disabled={disabled} aria-label={day} aria-pressed={date===day} onClick={()=>{onChange(day+' '+time);setOpen(false)}}>{i+1}</button>})}</div><button type="button" className="link" disabled={disabled} onClick={()=>{onChange('');setOpen(false)}}>Borrar fecha</button></div>}
  <label htmlFor={id+'time'}>Hora de envío</label><input id={id+'time'} aria-label="Hora de envío" type="text" inputMode="numeric" placeholder="hh:mm" maxLength={5} value={time} disabled={disabled||!date} onChange={e=>onChange(date+' '+e.target.value)}/>
  <small>Formato español: día/mes/año. Si se omite, se usa la fecha del registro.</small>
 </div>;
}
export function parseSpanishShipmentDate(value:string):string|null{
 const match=/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value);if(!match)return null;
 const [,day,month,year,hour,minute]=match;const parsed=new Date(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute));
 if(parsed.getFullYear()!==Number(year)||parsed.getMonth()!==Number(month)-1||parsed.getDate()!==Number(day)||parsed.getHours()!==Number(hour)||parsed.getMinutes()!==Number(minute))return null;
 return parsed.toISOString();
}
