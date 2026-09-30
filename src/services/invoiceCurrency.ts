export type InvoiceCurrencyEvidence={
  currency:string;
  confidence:number;
  evidence:string[];
};

const ISO_CODES=[
  'EUR','USD','GBP','CHF','CAD','AUD','NZD','JPY','CNY','SGD','HKD',
  'SEK','NOK','DKK','PLN','CZK','HUF','RON','BGN','MXN','BRL','INR',
] as const;

function occurrences(text:string,pattern:RegExp){
  const flags=pattern.flags.includes('g')?pattern.flags:pattern.flags+'g';
  return [...text.matchAll(new RegExp(pattern.source,flags))].length;
}

export function detectInvoiceCurrency(rawText:string):InvoiceCurrencyEvidence|null{
  const text=String(rawText||'');
  if(!text.trim())return null;

  const scores=new Map<string,{score:number;evidence:string[]}>();
  const add=(currency:string,score:number,evidence:string)=>{
    const current=scores.get(currency)||{score:0,evidence:[]};
    current.score+=score;
    if(!current.evidence.includes(evidence))current.evidence.push(evidence);
    scores.set(currency,current);
  };

  for(const code of ISO_CODES){
    const count=occurrences(text,new RegExp('\\b'+code+'\\b','gi'));
    if(count)add(code,90+Math.min(30,count*8),code);
  }
  const rmb=occurrences(text,/\bRMB\b/gi);
  if(rmb)add('CNY',95+Math.min(25,rmb*8),'RMB');

  const taggedSymbols:Array<[RegExp,string,string]>= [
    [/US\s*\$/gi,'USD','US$'],
    [/CA\s*\$/gi,'CAD','CA$'],
    [/A\s*\$/gi,'AUD','A$'],
    [/NZ\s*\$/gi,'NZD','NZ$'],
    [/S\s*\$/gi,'SGD','S$'],
    [/HK\s*\$/gi,'HKD','HK$'],
  ];
  for(const [pattern,currency,label] of taggedSymbols){
    const count=occurrences(text,pattern);
    if(count)add(currency,100+Math.min(30,count*8),label);
  }

  const euro=occurrences(text,/€/g);
  if(euro)add('EUR',75+Math.min(35,euro*6),'€');
  const pound=occurrences(text,/£/g);
  if(pound)add('GBP',75+Math.min(35,pound*6),'£');
  const rupee=occurrences(text,/₹/g);
  if(rupee)add('INR',75+Math.min(35,rupee*6),'₹');

  // El símbolo $ sin prefijo no se convierte nunca en EUR. Si no existe una
  // evidencia explícita de otro dólar, se interpreta como USD: es la convención
  // de facturas internacionales en inglés y evita el antiguo fallback erróneo a EUR.
  const bareDollar=occurrences(text,/(?<![A-Za-z])\$(?=\s*\d)/g);
  if(bareDollar)add('USD',65+Math.min(35,bareDollar*6),'$');

  const yen=occurrences(text,/¥/g);
  if(yen){
    const hasChina=/\b(?:CNY|RMB|china|chinese|yuan)\b/i.test(text);
    add(hasChina?'CNY':'JPY',60+Math.min(30,yen*6),'¥');
  }

  if(!scores.size)return null;
  const ranked=[...scores.entries()]
    .map(([currency,value])=>({currency,score:value.score,evidence:value.evidence}))
    .sort((a,b)=>b.score-a.score);

  const best=ranked[0];
  const next=ranked[1];
  const margin=next?best.score-next.score:best.score;
  const confidence=Math.max(.55,Math.min(.99,(best.score>=100?.94:.82)+(margin>=30?.04:0)));
  return {currency:best.currency,confidence,evidence:best.evidence};
}

export function normalizeInvoiceCurrency(value:string|undefined|null,fallback='EUR'){
  const code=String(value||'').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code)?code:fallback.toUpperCase();
}
