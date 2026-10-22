const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function parts(date:Date){return Object.fromEntries(formatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]))}
export function formatMadridPickupTime(date=new Date()):string{if(!Number.isFinite(date.getTime()))return '';const p=parts(date);return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`}
export function parseMadridPickupTime(value:string):string|null{
 const match=/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value);if(!match)return null;
 const [,day,month,year,hour,minute]=match.map(Number);if(year<2000||year>2100||month<1||month>12||hour>23||minute>59||day<1)return null;
 const wall=Date.UTC(year,month-1,day,hour,minute),check=new Date(wall);if(check.getUTCDate()!==day||check.getUTCMonth()!==month-1)return null;
 let guess=wall;for(let i=0;i<4;i++){const p=parts(new Date(guess)),offset=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-guess,next=wall-offset;if(next===guess)break;guess=next}
 return formatMadridPickupTime(new Date(guess))===value?new Date(guess).toISOString():null;
}
