const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

const legalSuffixPattern = '(?:S\\.?\\s*L\\.?\\s*U?\\.?|S\\.?\\s*A\\.?|SLU|SL|SA|C\\.?\\s*B\\.?|CB|LTD\\.?|LIMITED|GMBH|SAS|B\\.?\\s*V\\.?|BV|LLC|INC\\.?|PLC)';
const legalSuffixRegex = new RegExp(`\\b${legalSuffixPattern}(?=\\s|$|[,;:.])`, 'i');

export function canonicalizeSupplierName(value: string): string {
  let result = compact(String(value || ''))
    .replace(/^(?:un\s+cordial\s+saludo|cordialmente|atentamente|saludos?|gracias)[,:;\s-]+/i, '')
    .replace(/^[\s:;,.–—¡!·-]+|[\s:;,.–—-]+$/g, '')
    .trim();
  if (!result) return '';

  const legalMatch = result.match(new RegExp(`^(.{2,120}?\\b${legalSuffixPattern})(?=\\s|$|[,;:.])`, 'i'));
  if (legalMatch?.[1]) result = compact(legalMatch[1]);

  result = result
    .replace(/\s+(?:IBAN|BIC|SWIFT|NIF|CIF|VAT|IVA|TAX\s*ID|TEL(?:ÉFONO)?|TÉL(?:ÉFONO)?|PHONE|E-?MAIL|CORREO|BANCO|BANK|CUENTA\s+BANCARIA)\s*[:.-]?.*$/i, '')
    .replace(/\s+(?:https?:\/\/|www\.).*$/i, '')
    .replace(/[\s:;,.–—-]+$/g, '')
    .trim();

  return result.slice(0, 120);
}

export function isPlausibleSupplierName(value:string):boolean{
  const name=canonicalizeSupplierName(value);
  if(name.length<3||name.length>120)return false;
  if(/zenvia\s+commerce/i.test(name))return false;
  if(/^(?:proveedor\s+gmail|factura|invoice|cliente|customer|pedido(?:\s+de\s+cliente)?|albar[aá]n|original|copia|proforma|presupuesto)$/i.test(name))return false;
  if(/\b(?:iban|bic|swift|base\s+imponible|total\s+factura|fecha\s+factura|forma\s+de\s+pago)\b/i.test(name))return false;
  if(/^(?:calle|c\/|avda\.?|avenida|p\.?\s*i\.?|pol[ií]gono|carretera|ctra\.?|plaza|paseo|camino)\b/i.test(name))return false;
  // Evita que el OCR convierta una línea postal como "11660 PRADO DEL REY"
  // en proveedor. Este fue el origen de varios gastos "sin asignar".
  if(/^(?:[A-Z]{2}[-\s]?)?\d{4,6}\s+[A-Za-zÁÉÍÓÚÑÜáéíóúñü]/.test(name))return false;
  if(/^\d+(?:[.,]\d+)?(?:\s*(?:€|EUR))?$/i.test(name))return false;
  const letters=(name.match(/[A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g)||[]).length;
  const digits=(name.match(/\d/g)||[]).length;
  return letters>=3&&digits<=Math.max(6,Math.round(letters*.55));
}

export function supplierIdentityKey(value: string): string {
  return canonicalizeSupplierName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function supplierCoreKey(value: string): string {
  return supplierIdentityKey(value)
    .replace(/\s+(?:s\s*l\s*u|slu|s\s*l|sl|s\s*a|sa|c\s*b|cb|b\s*v|bv|ltd|limited|gmbh|sas|llc|inc|plc)$/i, '')
    .trim();
}

function meaningfulSupplierTokens(value:string){
  const ignored=new Set(['and','y','de','del','la','las','el','los','the','company','co','grupo','group']);
  return value.split(/\s+/).filter(token=>token.length>=3&&!ignored.has(token));
}

function editDistance(a:string,b:string){
  if(a===b)return 0;
  if(!a.length)return b.length;
  if(!b.length)return a.length;
  const previous=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i+=1){
    let diagonal=previous[0];
    previous[0]=i;
    for(let j=1;j<=b.length;j+=1){
      const above=previous[j];
      const cost=a[i-1]===b[j-1]?0:1;
      previous[j]=Math.min(previous[j]+1,previous[j-1]+1,diagonal+cost);
      diagonal=above;
    }
  }
  return previous[b.length];
}

function ocrTokenEquivalent(a:string,b:string){
  if(a===b)return true;
  const min=Math.min(a.length,b.length);
  if(min<4)return false;
  const distance=editDistance(a,b);
  return distance<=1||(min>=7&&distance<=2);
}

function ocrSupplierMatch(aCore:string,bCore:string){
  const aTokens=meaningfulSupplierTokens(aCore);
  const bTokens=meaningfulSupplierTokens(bCore);
  if(aTokens.length<3||bTokens.length<3)return false;
  const shorter=aTokens.length<=bTokens.length?aTokens:bTokens;
  const longer=aTokens.length>bTokens.length?aTokens:bTokens;
  const used=new Set<number>();
  let matched=0;
  for(const token of shorter){
    const index=longer.findIndex((candidate,candidateIndex)=>!used.has(candidateIndex)&&ocrTokenEquivalent(token,candidate));
    if(index>=0){used.add(index);matched+=1;}
  }
  const coverage=matched/shorter.length;
  const lengthRatio=Math.min(aCore.length,bCore.length)/Math.max(aCore.length,bCore.length);
  return matched>=3&&coverage>=.8&&lengthRatio>=.55;
}

export function isLikelySameSupplier(a: string, b: string): boolean {
  const aKey = supplierIdentityKey(a);
  const bKey = supplierIdentityKey(b);
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;

  const aCore = supplierCoreKey(a);
  const bCore = supplierCoreKey(b);
  if (!aCore || !bCore) return false;
  if (aCore === bCore) {
    return aCore.length >= 8 && meaningfulSupplierTokens(aCore).length >= 2;
  }

  const shorter=aCore.length<=bCore.length?aCore:bCore;
  const longer=aCore.length>bCore.length?aCore:bCore;
  const contained=longer===shorter
    || longer.startsWith(shorter+' ')
    || longer.endsWith(' '+shorter);
  if(contained&&shorter.length>=12&&meaningfulSupplierTokens(shorter).length>=2)return true;

  // OCR tolerante pero conservador: exige al menos tres palabras significativas
  // y >=80 % de coincidencia. Corrige casos como "Siera ... ana Paper" sin
  // fusionar proveedores distintos que solo comparten "Sierra Nevada".
  return ocrSupplierMatch(aCore,bCore);
}

export function extractExplicitLegalSupplier(lines: string[]): string {
  const labelOnly = /^(?:proveedor|supplier|emisor|raz[oó]n\s+social)\s*[:.-]?\s*$/i;
  const inlineLabel = /^(?:proveedor|supplier|emisor|raz[oó]n\s+social)\s*[:.-]\s*(.+)$/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = compact(lines[index]);
    if (!line) continue;

    const inline = line.match(inlineLabel)?.[1];
    if (inline) {
      const candidate = canonicalizeSupplierName(inline);
      if (isPlausibleSupplierName(candidate)) return candidate;
    }

    if (labelOnly.test(line)) {
      for (let offset = 1; offset <= 3; offset += 1) {
        const next = canonicalizeSupplierName(lines[index + offset] || '');
        if (!next) continue;
        if (/zenvia\s+commerce/i.test(next)) break;
        if (/^(?:cliente|customer|interesado|destinatario|nif|cif|vat|direcci[oó]n)\b/i.test(next)) break;
        if (isPlausibleSupplierName(next)) return next;
      }
    }
  }

  for (const raw of lines) {
    const line = compact(raw);
    if (line.length < 4 || line.length > 180) continue;
    if (/zenvia\s+commerce/i.test(line)) continue;
    if (!legalSuffixRegex.test(line)) continue;

    const candidate = canonicalizeSupplierName(line);
    if (!candidate || /^(?:factura|invoice|cliente|customer)\b/i.test(candidate)) continue;
    if (isPlausibleSupplierName(candidate)) return candidate;
  }
  return '';
}
