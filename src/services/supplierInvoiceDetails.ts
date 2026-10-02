const compact=(value:string)=>value.replace(/\s+/g,' ').trim();
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export type SupplierInvoiceDetails={taxId?:string;address?:string;website?:string};

const buyerStart=/^(?:cliente\b|customer\b|bill\s+to\b|facturar\s+a\b|zenvia\s+commerce\b|cristian\s+(?:jesus\s+)?perez\s+garrido\b)/i;
const buyerBlockEnd=/^(?:factura\b|invoice\b|c[oó]digo(?:\s+descripci[oó]n)?\b|nif\s*\/\s*cif\b)/i;

function supplierBlock(text:string,supplierName:string){
  const lines=text.split(/\r?\n/).map(compact).filter(Boolean);
  const nameKey=normalized(supplierName);
  const supplierIndex=lines.findIndex(line=>{
    const key=normalized(line);
    return Boolean(nameKey)&&(key.includes(nameKey)||nameKey.includes(key));
  });
  if(supplierIndex<0)return lines.slice(0,16);

  const before=lines.slice(Math.max(0,supplierIndex-18),supplierIndex);
  const relevantBefore:string[]=[];
  let insideBuyerBlock=false;
  for(const line of before){
    if(buyerStart.test(line)){
      insideBuyerBlock=true;
      continue;
    }
    if(insideBuyerBlock){
      if(buyerBlockEnd.test(line)){
        insideBuyerBlock=false;
        relevantBefore.push(line);
      }
      continue;
    }
    relevantBefore.push(line);
  }

  const after:string[]=[];
  for(let index=supplierIndex;index<Math.min(lines.length,supplierIndex+12);index+=1){
    const line=lines[index];
    if(index>supplierIndex&&/^(?:factura|invoice|cliente\b|customer\b|bill\s+to\b|facturar\s+a\b|zenvia\s+commerce\b)/i.test(line))break;
    after.push(line);
  }
  return [...relevantBefore,...after];
}

function normalizeTaxId(value:string){return value.toUpperCase().replace(/[\s.-]/g,'').trim();}

function extractTaxId(lines:string[]){
  const label=/(?:C\.?\s*I\.?\s*F\.?|N\.?\s*I\.?\s*F\.?|VAT(?:\s*(?:ID|NO\.?|NUMBER))?)\s*[:#-]?\s*([A-Z]{0,2}\s*[A-Z0-9](?:[\s.-]*[A-Z0-9]){6,14})/i;
  for(const line of lines){
    const value=line.match(label)?.[1];
    if(value)return normalizeTaxId(value);
  }
  return undefined;
}

function extractRegisteredTaxId(lines:string[]){
  for(let index=0;index<lines.length;index+=1){
    if(!/registro\s+mercantil/i.test(lines[index]))continue;
    const window=lines.slice(index,Math.min(lines.length,index+3)).join(' ');
    const value=window.match(/(?:C\.?\s*[IL1]\.?\s*F\.?|N\.?\s*[IL1]\.?\s*F\.?)\s*[:#-]?\s*([A-Z]{0,2}\s*[A-Z0-9](?:[\s.-]*[A-Z0-9]){6,14})/i)?.[1];
    if(value)return normalizeTaxId(value);
  }
  return undefined;
}


function extractWebsite(lines:string[]){
  const explicit=/\b((?:https?:\/\/|www\.)[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s]*)?)\b/i;
  const plain=/\b([a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s]*)?)\b/i;
  // Prefer an explicit web address. OCR often drops the @ from an email and
  // turns "administracion@empresa.com" into a fake domain-like website.
  for(const line of lines){
    const value=line.match(explicit)?.[1];
    if(!value)continue;
    return /^https?:\/\//i.test(value)?value:`https://${value}`;
  }
  for(const line of lines){
    if(line.includes('@')||/\b(?:mail|email|correo)\b/i.test(line))continue;
    const value=line.match(plain)?.[1];
    if(!value)continue;
    return /^https?:\/\//i.test(value)?value:`https://${value}`;
  }
  return undefined;
}

function isAddressLine(line:string){
  if(/\b\d{5}\b/.test(line))return true;
  return /(?:^|\s)(?:c\/|c\.|calle\b|avda\.?\b|avenida\b|ctra\.?\b|carretera\b|camino\b|paseo\b|plaza\b|pol[ií]gono\b|nave\b|km\.?\b|merc[a-záéíóúñ]+\b)/i.test(line);
}

function extractAddress(lines:string[],supplierName:string){
  const nameKey=normalized(supplierName);
  const addressLines:string[]=[];
  for(const line of lines){
    const key=normalized(line);
    if(key===nameKey||key.includes(nameKey)||nameKey.includes(key))continue;
    if(/(?:C\.?\s*I\.?\s*F\.?|N\.?\s*I\.?\s*F\.?|VAT)/i.test(line))continue;
    if(/@|www\.|https?:\/\//i.test(line))continue;
    if(isAddressLine(line))addressLines.push(line);
  }
  return addressLines.length?addressLines.join(', '):undefined;
}

export function extractSupplierInvoiceDetails(text:string,supplierName:string):SupplierInvoiceDetails{
  if(!text.trim()||!supplierName.trim())return {};
  const block=supplierBlock(text,supplierName);
  return {
    taxId:extractTaxId(block)||extractRegisteredTaxId(text.split(/\r?\n/).map(compact).filter(Boolean)),
    address:extractAddress(block,supplierName),
    website:extractWebsite(block),
  };
}
