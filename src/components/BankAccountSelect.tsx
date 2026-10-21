import {useCallback,useEffect,useRef,useState} from 'react';
import {SelectField} from './forms/SelectField';
import {loadBusinessBankAccounts,type BusinessBankAccount,type BankAccountSnapshot,type BankAccountSnapshotSource} from '../services/businessBankAccounts';
import type {SalesSettings} from '../services/settingsSchema';
import {errorMessage} from '../services/toast';
import {formatBankAccountIban} from './bankAccountDisplay';
import './business-bank-accounts.css';

export const MISSING_BANK_ACCOUNT='Falta una cuenta bancaria en Configuración → General';
export const bankAccountUsable=(account:BusinessBankAccount)=>!account.archivedAt&&account.validationStatus==='valid';
export function defaultBankAccountId(accounts:BusinessBankAccount[],seriesDefault?:string|null){
 return accounts.find(account=>account.id===seriesDefault&&bankAccountUsable(account))?.id||accounts.find(account=>account.isDefault&&bankAccountUsable(account))?.id||'';
}
export function documentPaymentMethodId(sales:SalesSettings,label?:string|null,persistedId?:string|null){
 if(persistedId)return persistedId;
 const method=sales.paymentMethods.find(item=>item.label===label);
 if(method)return method.id;
 return label?.trim().toLocaleLowerCase('es')==='transferencia bancaria'?'bank_transfer':null;
}
export function BankSettingsLink(){return <a href="#configuracion-general" onClick={event=>{event.preventDefault();window.dispatchEvent(new Event('zenvia:open-bank-settings'));}}>Configurar cuentas bancarias</a>}

export function useBankAccountChoice({active=true,documentKey,persistedId,seriesDefaultId}:{active?:boolean;documentKey:string;persistedId?:string|null;seriesDefaultId?:string|null}){
 const [accounts,setAccounts]=useState<BusinessBankAccount[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [value,setValue]=useState(persistedId||'');
 const manual=useRef(Boolean(persistedId));
 const generation=useRef(0);
 const reload=useCallback(async()=>{
  const current=++generation.current;setLoading(true);setError('');
  try{const rows=await loadBusinessBankAccounts();if(current===generation.current)setAccounts(rows)}
  catch(e){if(current===generation.current)setError(errorMessage(e,'No se pudieron cargar las cuentas bancarias.'))}
  finally{if(current===generation.current)setLoading(false)}
 },[]);
 useEffect(()=>{manual.current=Boolean(persistedId);setValue(persistedId||'');},[documentKey,persistedId,active]);
 useEffect(()=>{if(active)void reload();return()=>{generation.current++}},[active,documentKey,reload]);
 useEffect(()=>{if(!active)return;const refresh=()=>void reload();window.addEventListener('zenvia:bank-accounts-changed',refresh);window.addEventListener('focus',refresh);return()=>{window.removeEventListener('zenvia:bank-accounts-changed',refresh);window.removeEventListener('focus',refresh)}},[active,reload]);
 useEffect(()=>{if(active&&!manual.current)setValue(defaultBankAccountId(accounts,seriesDefaultId));},[active,accounts,seriesDefaultId,documentKey]);
 const choose=(id:string)=>{manual.current=true;setValue(id)};
 const selectionError=value&&!accounts.some(account=>account.id===value&&bankAccountUsable(account))?'La cuenta bancaria seleccionada ya no está disponible. Elige otra cuenta.':'';
 return {accounts,loading,error,reload,value,choose,selectionError};
}

export function BankAccountSelect({accounts,value,onChange,required=false,disabled=false,loading=false,error='',onRetry,emptyLabel='Sin cuenta bancaria',ariaLabel='Cuenta bancaria',allowEmpty=false}:{accounts:BusinessBankAccount[];value:string;onChange:(id:string)=>void;required?:boolean;disabled?:boolean;loading?:boolean;error?:string;onRetry?:()=>void;emptyLabel?:string;ariaLabel?:string;allowEmpty?:boolean}){
 const selected=accounts.find(account=>account.id===value);
 const options=accounts.filter(bankAccountUsable).map(account=>({value:account.id,label:`${account.alias} · ${formatBankAccountIban(account.iban)}`}));
 if(value&&!options.some(option=>option.value===value))options.push({value,label:selected?`${selected.alias} · ${selected.archivedAt?'Archivada':'Pendiente de revisión'}`:'Cuenta no disponible'});
 const invalid=Boolean(value&&!accounts.some(account=>account.id===value&&bankAccountUsable(account)));
 return <div className="bankAccountField"><label><span>Cuenta bancaria</span><SelectField ariaLabel={ariaLabel} value={value} onChange={onChange} options={options} allowEmpty={allowEmpty||!accounts.some(bankAccountUsable)} emptyLabel={emptyLabel} disabled={disabled||loading}/></label>
  {loading&&<small role="status">Cargando cuentas bancarias…</small>}
  {error?<div role="alert" className="bankAccountWarning">{error}{onRetry&&<button type="button" className="link" onClick={onRetry}>Reintentar</button>}</div>:!loading&&invalid?<div role="alert" className="bankAccountWarning">La cuenta bancaria seleccionada ya no está disponible. Elige otra cuenta. <BankSettingsLink/></div>:!loading&&required&&!value?<div role="alert" className="bankAccountWarning"><span>{MISSING_BANK_ACCOUNT}</span><BankSettingsLink/></div>:null}
 </div>;
}

export function BankAccountSnapshotView({snapshot,source,capturedAt}:{snapshot?:BankAccountSnapshot|null;source?:BankAccountSnapshotSource|null;capturedAt?:string|null}){
 return <section className="bankAccountSnapshot" aria-label="Cuenta bancaria del documento"><h4>Cuenta bancaria del documento</h4>
  {snapshot?<dl><dt>Cuenta</dt><dd>{snapshot.alias}</dd><dt>IBAN</dt><dd className="bankAccountNumber">{snapshot.iban}</dd>{snapshot.bic&&<><dt>BIC / SWIFT</dt><dd>{snapshot.bic}</dd></>}{snapshot.holder&&<><dt>Titular</dt><dd>{snapshot.holder}</dd></>}</dl>:<p>Este documento no tiene datos bancarios conservados.</p>}
  <small>{source==='legacy_current_render'?'Datos conservados al actualizar la configuración; no acreditan la cuenta original de emisión.':source==='legacy_missing'?'Documento anterior sin datos bancarios conservados.':'Los datos bancarios de este documento son de solo lectura.'}{capturedAt?` Capturados el ${new Date(capturedAt).toLocaleDateString('es-ES')}.`:''}</small>
 </section>;
}
