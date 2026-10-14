export function amazonCalendarDay(now:Date,timeZone:string){
  let formatter:Intl.DateTimeFormat;
  try{formatter=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});}
  catch{formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'});}
  const parts=formatter.formatToParts(now);
  const part=(name:string)=>parts.find(value=>value.type===name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function amazonCalendarDate(day:string){
  const [year,month,date]=day.split('-').map(Number);
  return new Date(year,month-1,date,12);
}
// Check the clock locally; fetch analytics only when the business day changes.
export function watchAmazonCalendarDay(onChange:(previous:string,next:string)=>void,timeZone:string){
  let day=amazonCalendarDay(new Date(),timeZone);
  const check=()=>{
    if(document.hidden)return;
    const next=amazonCalendarDay(new Date(),timeZone);
    if(next===day)return;
    const previous=day;day=next;onChange(previous,next);
  };
  const timer=window.setInterval(check,30_000);
  window.addEventListener('focus',check);
  document.addEventListener('visibilitychange',check);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
}
