const normalize=(value:string)=>value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .replace(/[’']/g,"'")
  .toLowerCase();

const months:Record<string,number>={
  jan:1,january:1,enero:1,janvier:1,gennaio:1,janeiro:1,januar:1,
  feb:2,february:2,febrero:2,fevrier:2,febbraio:2,fevereiro:2,februar:2,
  mar:3,march:3,marzo:3,mars:3,marco:3,marz:3,maerz:3,
  apr:4,april:4,abril:4,avril:4,aprile:4,
  may:5,mayo:5,mai:5,maggio:5,maio:5,
  jun:6,june:6,junio:6,juin:6,giugno:6,junho:6,juni:6,
  jul:7,july:7,julio:7,juillet:7,luglio:7,julho:7,juli:7,
  aug:8,august:8,agosto:8,aout:8,
  sep:9,sept:9,september:9,septiembre:9,setiembre:9,septembre:9,settembre:9,setembro:9,
  oct:10,october:10,octubre:10,octobre:10,ottobre:10,outubro:10,okt:10,oktober:10,
  nov:11,november:11,noviembre:11,novembre:11,
  dec:12,december:12,diciembre:12,decembre:12,dicembre:12,dez:12,dezembro:12,dezember:12,
};

const monthAlternation=Object.keys(months)
  .sort((a,b)=>b.length-a.length)
  .map(value=>value.replace(/[.*+?^$()|[\]\\{}]/g,'\\$&'))
  .join('|');

const strongIssueLabel=/(?:fecha\s+(?:de\s+)?(?:factura|emision)|invoice\s+date|date\s+of\s+issue|issue\s+date|issued\s+on|data\s+fattura|data\s+(?:da\s+)?fatura|date\s+de\s+facture|rechnungsdatum|datum\s+der\s+rechnung)/i;
const genericDateLabel=/(?:^|\b)(?:fecha|date|datum|data)(?:\b|\s*:)/i;
const negativeDateLabel=/(?:due\s+date|date\s+due|payment\s+due|fecha\s+(?:de\s+)?vencimiento|vencimiento|date\s+d['’]?echeance|echeance|scadenza|faellig|fallig|zahlbar|delivery\s+date|fecha\s+(?:de\s+)?entrega|service\s+date|check[ -]?in|check[ -]?out)/i;

function validDate(year:number,month:number,day:number){
  if(year<2000||year>2100||month<1||month>12||day<1||day>31)return false;
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}

function iso(year:number,month:number,day:number){
  return validDate(year,month,day)
    ?year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')
    :'';
}

function modernYear(raw:string){
  const value=Number(raw);
  if(raw.length===4)return value;
  return value<=79?2000+value:1900+value;
}

export function extractDateValues(value:string){
  const text=normalize(value).replace(/\s+/g,' ');
  const found:string[]=[];
  const add=(date:string)=>{if(date&&!found.includes(date))found.push(date);};

  for(const match of text.matchAll(/\b(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\b/g)){
    add(iso(Number(match[1]),Number(match[2]),Number(match[3])));
  }
  for(const match of text.matchAll(/\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(20\d{2}|\d{2})\b/g)){
    const first=Number(match[1]),second=Number(match[2]),year=modernYear(match[3]);
    // Convención europea por defecto. Si el segundo componente no puede ser mes,
    // el formato es inequívocamente MM/DD/YYYY y lo interpretamos como tal.
    add(second>12&&first<=12?iso(year,first,second):iso(year,second,first));
  }

  const dayMonthSeparated=new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*[-/.]\\s*('+monthAlternation+')\\.?\\s*[-/.]\\s*(20\\d{2}|\\d{2})\\b','g');
  for(const match of text.matchAll(dayMonthSeparated)){
    add(iso(modernYear(match[3]),months[match[2]],Number(match[1])));
  }

  const dayMonth=new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:de\\s+|of\\s+)?('+monthAlternation+')\\.?\\s*(?:de\\s+|,\\s*)?(20\\d{2}|\\d{2})\\b','g');
  for(const match of text.matchAll(dayMonth)){
    add(iso(modernYear(match[3]),months[match[2]],Number(match[1])));
  }

  const monthDay=new RegExp('\\b('+monthAlternation+')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,|\\s)+\\s*(20\\d{2}|\\d{2})\\b','g');
  for(const match of text.matchAll(monthDay)){
    add(iso(modernYear(match[3]),months[match[1]],Number(match[2])));
  }

  const yearMonthDay=new RegExp('\\b(20\\d{2})\\s+(?:de\\s+)?('+monthAlternation+')\\.?\\s+(\\d{1,2})\\b','g');
  for(const match of text.matchAll(yearMonthDay)){
    add(iso(Number(match[1]),months[match[2]],Number(match[3])));
  }

  return found;
}

export type InvoiceDateEvidence={
  date:string;
  score:number;
  line:string;
  reason:'issue_label'|'date_label'|'unlabelled';
};

export function extractInvoiceDateEvidence(text:string):InvoiceDateEvidence|null{
  const lines=text.split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean);
  const candidates:InvoiceDateEvidence[]=[];

  lines.forEach((line,index)=>{
    const normalizedLine=normalize(line);
    if(negativeDateLabel.test(normalizedLine))return;
    const dates=extractDateValues(line);
    if(!dates.length)return;

    let score=10;
    let reason:InvoiceDateEvidence['reason']='unlabelled';
    if(strongIssueLabel.test(normalizedLine)){score=150;reason='issue_label';}
    else if(genericDateLabel.test(normalizedLine)){score=90;reason='date_label';}

    score+=Math.max(0,25-Math.floor(index/2));
    if(dates.length===1)score+=8;
    for(const date of dates)candidates.push({date,score,line,reason});
  });

  if(!candidates.length)return null;

  const explicit=candidates.filter(candidate=>candidate.reason==='issue_label');
  const pool=explicit.length?explicit:candidates;
  const frequency=new Map<string,number>();
  for(const candidate of pool)frequency.set(candidate.date,(frequency.get(candidate.date)||0)+1);

  return [...pool]
    .map(candidate=>({...candidate,score:candidate.score+((frequency.get(candidate.date)||1)-1)*6}))
    .sort((a,b)=>b.score-a.score)[0]||null;
}

export function extractInvoiceDate(text:string){
  return extractInvoiceDateEvidence(text)?.date||'';
}
