import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {archiveBusinessBankAccount,loadBusinessBankAccounts,saveBusinessBankAccount,setDefaultBusinessBankAccount,type BusinessBankAccount,type BusinessBankAccountInput} from '../services/businessBankAccounts';
import {normalizeIban,validateBankAccountInput} from '../services/bankAccountValidation';
import {confirmAction} from '../services/actionDialog';
import {errorMessage,showSuccess} from '../services/toast';
import {FormModal} from './forms/FormPrimitives';
import {formatBankAccountIban} from './bankAccountDisplay';
import '../sales-config.css';
import './business-bank-accounts.css';

const emptyAccount=():BusinessBankAccountInput=>({alias:'',iban:'',bic:'',holder:'',isDefault:false});

// FormModal supplies the shared surface; dialog behavior stays local to this editor.
function BankAccountEditorDialog({title,busy,onClose,children,actions}:{title:string;busy:boolean;onClose:()=>void;children:ReactNode;actions:ReactNode}){
 const root=useRef<HTMLDivElement>(null),close=useRef(onClose),saving=useRef(busy);
 close.current=onClose;saving.current=busy;
 useEffect(()=>{
  const node=root.current?.querySelector<HTMLDivElement>('.formModal');if(!node)return;
  node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-label',title);node.tabIndex=-1;
  const opener=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:null;
  const fallback=node.closest('.businessBankAccounts')?.querySelector<HTMLButtonElement>('.settingsSubsectionHead > button');
  const focusable=()=>Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]'));
  const inerted:Array<{node:HTMLElement;inert:boolean}>=[];
  // Hide background controls from both keyboard navigation and assistive technology.
  for(let branch:HTMLElement|null=node;branch?.parentElement;branch=branch.parentElement){
   for(const sibling of branch.parentElement.children)if(sibling!==branch&&sibling instanceof HTMLElement){inerted.push({node:sibling,inert:sibling.inert});sibling.inert=true}
  }
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!saving.current)close.current();return}
   if(event.key!=='Tab')return;
   const controls=focusable(),first=controls[0],last=controls.at(-1);
   if(!first){event.preventDefault();node.focus();return}
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  };
  const focusin=(event:FocusEvent)=>{if(event.target instanceof Node&&!node.contains(event.target))(focusable()[0]||node).focus()};
  document.addEventListener('keydown',keydown,true);document.addEventListener('focusin',focusin);
  (node.querySelector<HTMLElement>('input')||focusable()[0]||node).focus();
  return()=>{document.removeEventListener('keydown',keydown,true);document.removeEventListener('focusin',focusin);inerted.forEach(item=>{item.node.inert=item.inert});(opener?.isConnected?opener:fallback)?.focus()};
 },[title]);
 useEffect(()=>{const button=root.current?.querySelector<HTMLButtonElement>('.formModalClose');if(button)button.disabled=busy;root.current?.querySelector('.formModal')?.setAttribute('aria-busy',String(busy))},[busy]);
 return <div ref={root} className="bankAccountDialog"><FormModal title={title} onClose={()=>{if(!busy)onClose()}} className="bankAccountModal" actions={actions}>{children}</FormModal></div>;
}

export function BusinessBankAccountsPanel({onChanged,onDirtyChange}:{onChanged?:()=>void|Promise<void>;onDirtyChange?:(dirty:boolean)=>void}){
 const [accounts,setAccounts]=useState<BusinessBankAccount[]>([]),[form,setForm]=useState<BusinessBankAccountInput>(emptyAccount),[editing,setEditing]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const formId=useId();
 const refresh=async()=>{setLoading(true);try{setAccounts(await loadBusinessBankAccounts());setError('')}catch(e){setError(errorMessage(e,'No se pudieron cargar las cuentas bancarias.'))}finally{setLoading(false)}};
 useEffect(()=>{void refresh()},[]);
 const update=<K extends keyof BusinessBankAccountInput>(key:K,value:BusinessBankAccountInput[K])=>{setForm(current=>({...current,[key]:value}));onDirtyChange?.(true)};
 const resetDraft=()=>{setEditing(false);setForm(emptyAccount());onDirtyChange?.(false)};
 const reset=()=>{resetDraft();setError('')};
 const open=(account?:BusinessBankAccount)=>{setForm(account?{id:account.id,alias:account.alias,iban:account.iban,bic:account.bic||'',holder:account.holder||'',isDefault:account.isDefault}:emptyAccount());setError('');setEditing(true)};
 const changed=async()=>{await refresh();window.dispatchEvent(new Event('zenvia:bank-accounts-changed'));await onChanged?.()};
 const save=async(event:React.FormEvent)=>{
  event.preventDefault();if(busy)return;setError('');
  try{validateBankAccountInput(form)}catch(e){setError(errorMessage(e,'Revisa los datos de la cuenta.'));return}
  setBusy(true);try{await saveBusinessBankAccount({...form,iban:normalizeIban(form.iban)});await changed();resetDraft();showSuccess(form.id?'Cuenta bancaria actualizada.':'Cuenta bancaria añadida.')}catch(e){setError(errorMessage(e,'No se pudo guardar la cuenta bancaria.'))}finally{setBusy(false)}
 };
 const makeDefault=async(account:BusinessBankAccount)=>{setBusy(true);setError('');try{await setDefaultBusinessBankAccount(account.id);await changed();showSuccess('Cuenta predeterminada actualizada.')}catch(e){setError(errorMessage(e,'No se pudo cambiar la cuenta predeterminada.'))}finally{setBusy(false)}};
 const remove=async(account:BusinessBankAccount)=>{
  if(!await confirmAction({title:'Eliminar cuenta bancaria',message:`Se retirará ${account.alias} para documentos nuevos.`,confirmLabel:'Eliminar',tone:'danger',details:['Los documentos existentes conservan sus datos bancarios.','Si es la cuenta predeterminada, se elegirá otra cuenta válida disponible.']}))return;
  setBusy(true);setError('');try{await archiveBusinessBankAccount(account.id);await changed();showSuccess('Cuenta bancaria retirada.')}catch(e){setError(errorMessage(e,'No se pudo eliminar la cuenta bancaria.'))}finally{setBusy(false)}
 };
 return <section className="settingsSubsection businessBankAccounts" data-independent-settings="bank-accounts" aria-label="Cuentas bancarias">
  <div className="settingsSubsectionHead"><div><h3>Cuentas bancarias</h3><p>Elige una cuenta predeterminada para documentos nuevos. También puedes elegir una cuenta distinta por factura o serie. Las facturas emitidas y los recibos guardados conservan sus datos bancarios.</p></div><button type="button" className="secondary" disabled={busy||loading} onClick={()=>open()}>Añadir cuenta</button></div>
  {loading?<p role="status">Cargando cuentas bancarias…</p>:<div className="configList bankAccountRows">{accounts.length?accounts.map(account=><article className="configRow bankAccountRow" key={account.id} aria-label={`Cuenta ${account.alias}`}><div className="configRowMain bankAccountRowMain"><strong>{account.alias}{account.isDefault&&<span className="pill ok">Predeterminada</span>}</strong><span className="bankAccountNumber">{formatBankAccountIban(account.iban)}</span>{account.bic&&<small>BIC / SWIFT: {account.bic}</small>}{account.holder&&<small>Titular: {account.holder}</small>}{account.validationStatus==='needs_review'&&<span className="bankAccountWarning">Pendiente de revisión</span>}</div><div className="configRowActions bankAccountActions">{!account.isDefault&&account.validationStatus==='valid'&&<button type="button" className="secondary" disabled={busy} onClick={()=>void makeDefault(account)}>Usar por defecto</button>}<button type="button" className="secondary" disabled={busy} onClick={()=>open(account)}>Editar</button><button type="button" className="secondary dangerText" disabled={busy} onClick={()=>void remove(account)}>Eliminar</button></div></article>):<p className="configEmpty">No hay cuentas bancarias. Añade una para cobrar por transferencia.</p>}</div>}
  {error&&!editing&&<div role="alert" className="errorBox">{error}<button type="button" className="link" disabled={busy} onClick={()=>void refresh()}>Actualizar cuentas</button></div>}
  {editing&&<BankAccountEditorDialog title={form.id?'Editar cuenta bancaria':'Nueva cuenta bancaria'} busy={busy} onClose={reset} actions={<><button type="button" className="secondary" disabled={busy} onClick={reset}>Cancelar</button><button type="submit" form={formId} className="primary" disabled={busy||loading}>{busy?'Guardando…':'Guardar'}</button></>}><form id={formId} onSubmit={event=>void save(event)}><div className="settingsFormGrid settingsFormGridWide bankAccountFormGrid"><label className="settingsField"><span>Alias de la cuenta</span><input autoComplete="off" maxLength={100} value={form.alias} onChange={event=>update('alias',event.target.value)} disabled={busy} placeholder="Cuenta principal"/></label><label className="settingsField settingsFieldWide"><span>IBAN de la cuenta</span><input autoComplete="off" value={form.iban} onChange={event=>update('iban',event.target.value)} disabled={busy} placeholder="ES…"/></label><label className="settingsField"><span>BIC / SWIFT <span className="optionalLabel">(opcional)</span></span><input autoComplete="off" value={form.bic||''} onChange={event=>update('bic',event.target.value)} disabled={busy}/></label><label className="settingsField settingsFieldWide"><span>Titular <span className="optionalLabel">(opcional)</span></span><input maxLength={200} value={form.holder||''} onChange={event=>update('holder',event.target.value)} disabled={busy}/></label><label className="bankAccountWide configCheckboxLabel"><input type="checkbox" checked={Boolean(form.isDefault)} onChange={event=>update('isDefault',event.target.checked)} disabled={busy}/>Usar por defecto</label>{error&&<div role="alert" className="errorBox bankAccountWide">{error}</div>}</div></form></BankAccountEditorDialog>}
 </section>;
}
