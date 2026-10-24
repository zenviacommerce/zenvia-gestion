/** Offline AEAT v0.1.2 invoice hash. No network, XML generation or compliance claim. */
export interface AltaHashFields {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  TipoFactura: string;
  CuotaTotal: string;
  ImporteTotal: string;
  /** Explicitly empty only for the first record; otherwise uppercase SHA256. */
  Huella: string;
  /** Persist this exact lexical value, including numeric offset, alongside its instant. */
  FechaHoraHusoGenRegistro: string;
}
export interface AnulacionHashFields {
  IDEmisorFacturaAnulada: string;
  NumSerieFacturaAnulada: string;
  FechaExpedicionFacturaAnulada: string;
  Huella: string;
  FechaHoraHusoGenRegistro: string;
}

function assertUnicode(value: string): void {
  // TextEncoder silently replaces unpaired UTF16 surrogates; reject instead.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw new Error('Invalid Unicode');
  }
}
function field(value: string, name: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  assertUnicode(value);
  const result = value.trim();
  if ((!allowEmpty && !result) || /[\u0000-\u001F\u007F]/u.test(result)) throw new Error(`Invalid ${name}`);
  return result;
}
function validDate(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function issueDate(value: string, name: string): string {
  const result = field(value, name);
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(result);
  if (!match || !validDate(+match[3], +match[2], +match[1])) throw new Error(`Invalid ${name}`);
  return result;
}
function timestamp(value: string): string {
  const result = field(value, 'FechaHoraHusoGenRegistro');
  // Deliberate phase1 subset: seconds and explicit numeric offset; no implicit timezone.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/.exec(result);
  if (!m || !validDate(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59 || +m[8] > 14 || +m[9] > 59 || (+m[8] === 14 && +m[9] !== 0)) {
    throw new Error('Invalid FechaHoraHusoGenRegistro (numeric timezone required)');
  }
  return result;
}
/** Application policy: canonical decimal2; never round, and never parse money as Number. */
function money(value: string, name: string): string {
  const result = field(value, name);
  const m = /^([+-]?)(\d{1,12})(?:\.(\d{0,2}))?$/.exec(result);
  if (!m) throw new Error(`Invalid ${name} decimal (max 12 integer and 2 fractional digits)`);
  const integer = m[2].replace(/^0+(?=\d)/, '');
  const fraction = (m[3] ?? '').padEnd(2, '0');
  const sign = m[1] === '-' && (integer !== '0' || fraction !== '00') ? '-' : '';
  return `${sign}${integer}.${fraction}`;
}
function previousHash(value: string): string {
  const result = field(value, 'Huella', true);
  if (result && !/^[0-9A-F]{64}$/.test(result)) throw new Error('Invalid Huella');
  return result;
}
function join(fields: Array<[string, string]>): string {
  // AEAT concatenates actual values: no URL encoding, XML escaping or Unicode normalization.
  return fields.map(([name, value]) => `${name}=${value}`).join('&');
}
export function buildAltaHashInput(input: AltaHashFields): string {
  const type = field(input.TipoFactura, 'TipoFactura');
  if (!/^(F[123]|R[12345])$/.test(type)) throw new Error('Invalid TipoFactura');
  return join([
    ['IDEmisorFactura', field(input.IDEmisorFactura, 'IDEmisorFactura')],
    ['NumSerieFactura', field(input.NumSerieFactura, 'NumSerieFactura')],
    ['FechaExpedicionFactura', issueDate(input.FechaExpedicionFactura, 'FechaExpedicionFactura')],
    ['TipoFactura', type],
    ['CuotaTotal', money(input.CuotaTotal, 'CuotaTotal')],
    ['ImporteTotal', money(input.ImporteTotal, 'ImporteTotal')],
    ['Huella', previousHash(input.Huella)],
    ['FechaHoraHusoGenRegistro', timestamp(input.FechaHoraHusoGenRegistro)],
  ]);
}
export function buildAnulacionHashInput(input: AnulacionHashFields): string {
  return join([
    ['IDEmisorFacturaAnulada', field(input.IDEmisorFacturaAnulada, 'IDEmisorFacturaAnulada')],
    ['NumSerieFacturaAnulada', field(input.NumSerieFacturaAnulada, 'NumSerieFacturaAnulada')],
    ['FechaExpedicionFacturaAnulada', issueDate(input.FechaExpedicionFacturaAnulada, 'FechaExpedicionFacturaAnulada')],
    ['Huella', previousHash(input.Huella)],
    ['FechaHoraHusoGenRegistro', timestamp(input.FechaHoraHusoGenRegistro)],
  ]);
}
/** Raw cryptographic helper: callers must build/validate invoice input first. */
export async function sha256Hex(canonical: string): Promise<string> {
  if (typeof canonical !== 'string') throw new Error('Hash input must be a string');
  assertUnicode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}
