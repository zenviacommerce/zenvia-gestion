import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LoaderCircle, LockKeyhole, LogOut, Moon, Sun } from 'lucide-react';
import { Sidebar, type Page, type ThemeMode } from './components/Sidebar';
import { UploadInvoiceModal } from './components/UploadInvoiceModal';
import { BulkInvoiceImportModal } from './components/BulkInvoiceImportModal';
import { ProductModal } from './components/ProductModal';
import { SupplierModal } from './components/SupplierModal';
import { ToastHost } from './components/ToastHost';
import { AlertCenter } from './components/AlertCenter';
import { AppAgent, type AppAgentAction } from './components/AppAgent';
import { AuthScreen } from './components/AuthScreen';
import { InvitePasswordSetup } from './components/InvitePasswordSetup';
import { InviteTokenSetup } from './components/InviteTokenSetup';
import { RecoveryTokenSetup } from './components/RecoveryTokenSetup';
import { PasskeySetup } from './components/PasskeySetup';
import { useSettings } from './context/SettingsContext';
import { Dashboard } from './pages/Dashboard';
import { ExpenseInvoicesHub } from './pages/ExpenseInvoicesHub';
import { SalesInvoices } from './pages/SalesInvoices';
import { Orders } from './pages/Orders';
import { Clients } from './pages/Clients';
import { Products } from './pages/Products';
import { Suppliers } from './pages/Suppliers';
import { AmazonPage } from './pages/Amazon';
import { AdminPage } from './pages/Admin';
import { SettingsPage } from './pages/Settings';
import { SupportPage } from './pages/Support';
import { bootstrapTenantFromLocation, supabase } from './services/supabase';
import { loadAccessProfile, type AccessProfile, type MenuPermission } from './services/access';
import { bootstrapUser, createInvoice, deleteProduct, deleteSupplier, getInvoiceFileUrl, loadAppData, updateInvoiceStatus } from './services/repository';
import { addSupplier, updateSupplier, type SupplierInput } from './services/supplierEditor';
import { updateInvoiceCategory, updateInvoiceSupplier } from './services/invoiceEditor';
import { addProduct, updateProduct, type ProductInput } from './services/productEditor';
import { deleteInvoiceWithGmailRecovery } from './services/invoiceLifecycle';
import { errorMessage, showError, showSuccess } from './services/toast';
import { confirmAction } from './services/actionDialog';
import { safeStorageGet, safeStorageSet } from './services/browserStorage';
import { effectiveStartPage } from './services/uiPreferences';
import { loadCompanyBranding } from './services/companyBranding';
import type { AppData, Invoice, NewInvoiceInput, Product, Supplier } from './types';

const emptyData: AppData = { invoices: [], products: [], suppliers: [], categories: [] };
const THEME_KEY = 'zenvia-gestion-theme';
const THEME_PREFERENCE_KEY = 'zenvia-gestion-theme-preference';
const regularPages: MenuPermission[] = ['dashboard','sales','orders','invoices','clients','products','suppliers','amazon','support'];

function withTimeout<T>(promise:Promise<T>,ms:number,message:string):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(new Error(message)),ms);
    promise.then(value=>{window.clearTimeout(timer);resolve(value)},error=>{window.clearTimeout(timer);reject(error)});
  });
}

function initialTheme(): ThemeMode {
  const preference=safeStorageGet('local',THEME_PREFERENCE_KEY);
  if(preference==='dark'||preference==='light')return preference;
  const stored=safeStorageGet('local',THEME_KEY);
  if(stored==='dark'||stored==='light')return stored;
  return 'light';
}

export default function App(){
 const {settings,preferences,patchPreferences,loading:settingsLoading}=useSettings();
 const [session,setSession]=useState<Session|null>(null);
 const [authReady,setAuthReady]=useState(false);
 const [authClientVersion,setAuthClientVersion]=useState(0);
 const [tenantBootstrapError,setTenantBootstrapError]=useState('');
 const inviteToken=typeof window!=='undefined'?(new URLSearchParams(window.location.search).get('invite_token')||'').trim():'';
 const recoveryToken=typeof window!=='undefined'?(new URLSearchParams(window.location.search).get('recovery_token')||'').trim():'';
 const [access,setAccess]=useState<AccessProfile|null>(null);
 const [accessReady,setAccessReady]=useState(false);
 const [data,setData]=useState<AppData>(emptyData);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [page,setPage]=useState<Page>('dashboard');
 const [ordersPendingEntry,setOrdersPendingEntry]=useState(false);
 const [upload,setUpload]=useState(false);
 const [bulkUpload,setBulkUpload]=useState(false);
 const [productModal,setProductModal]=useState(false);
 const [productToEdit,setProductToEdit]=useState<Product|null>(null);
 const [supplierModal,setSupplierModal]=useState(false);
 const [supplierToEdit,setSupplierToEdit]=useState<Supplier|null>(null);
 const [theme,setTheme]=useState<ThemeMode>(initialTheme);
 const [settingsDirty,setSettingsDirty]=useState(false);
 const [passkeySetupVisible,setPasskeySetupVisible]=useState(false);
 const [workspaceLogo,setWorkspaceLogo]=useState<string|null>(null);
 const startPageApplied=useRef(false);
 const userId=session?.user.id||null;

 const allowedPages=useMemo<Page[]>(()=>{
   if(!access?.active) return [];
   const moduleEnabled=(permission:MenuPermission)=>access.entitlements[`module.${permission}`]?.enabled ?? true;
   const permitted=access.role==='admin'
     ? regularPages
     : regularPages.filter(item=>access.permissions.includes(item));
   const visible:Page[]=permitted.filter(moduleEnabled);
   const settingsEnabled=access.entitlements['module.settings']?.enabled ?? true;
   const adminEnabled=access.entitlements['module.admin']?.enabled ?? true;
   if(settingsEnabled)visible.push('settings');
   if(access.role==='admin'&&adminEnabled)visible.push('admin');
   return visible;
 },[access]);
 const can=(permission:MenuPermission)=>Boolean(
   access?.active
   &&(access.role==='admin'||access.permissions.includes(permission))
   &&(access.entitlements[`module.${permission}`]?.enabled ?? true)
 );

 useEffect(()=>{
   const onSettingsDirty=(event:Event)=>setSettingsDirty(Boolean((event as CustomEvent<{dirty?:boolean}>).detail?.dirty));
   window.addEventListener('zenvia:settings-dirty',onSettingsDirty);
   return()=>window.removeEventListener('zenvia:settings-dirty',onSettingsDirty);
 },[]);

 useEffect(()=>{
   setTheme(preferences.theme);
 },[preferences.theme]);

 useEffect(()=>{
   document.documentElement.dataset.theme=theme;
   document.documentElement.style.colorScheme=theme;
   safeStorageSet('local',THEME_KEY,theme);
 },[theme]);

 useEffect(()=>{
   safeStorageSet('local',THEME_PREFERENCE_KEY,preferences.theme);
 },[preferences.theme]);

 useEffect(()=>{
   document.documentElement.dataset.density=preferences.density;
 },[preferences.density]);

 const refresh=useCallback(async()=>{
   setLoading(true); setError('');
   try { setData(await loadAppData()); }
   catch(e){ setError(e instanceof Error?e.message:'No se pudieron cargar los datos.'); }
   finally{ setLoading(false); }
 },[]);

 const refreshWorkspaceBranding=useCallback(async()=>{
   try{
     const branding=await loadCompanyBranding();
     setWorkspaceLogo(branding.logoDataUrl||null);
   }catch{
     setWorkspaceLogo(null);
   }
 },[]);

 const loadAccessAndBranding=useCallback(async(targetUserId:string)=>{
   const profile=await loadAccessProfile(targetUserId);
   const branding=profile?.active?await loadCompanyBranding().catch(()=>null):null;
   return {profile,workspaceLogo:branding?.logoDataUrl||null};
 },[]);

 useEffect(()=>{
   const onProductsChanged=()=>{void refresh();};
   window.addEventListener('zenvia:products-changed',onProductsChanged);
   return()=>window.removeEventListener('zenvia:products-changed',onProductsChanged);
 },[refresh]);

 useEffect(()=>{
   let cancelled=false;
   let unsubscribe:undefined|(()=>void);
   setAuthReady(false);
   void (async()=>{
     let resolution;
     try{
       resolution=await bootstrapTenantFromLocation();
       if(!cancelled)setTenantBootstrapError('');
     }catch(error){
       if(!cancelled){
         setTenantBootstrapError(error instanceof Error?error.message:'No se pudo localizar tu empresa.');
         setSession(null);setAuthReady(true);
       }
       return;
     }
     if(cancelled)return;
     if(resolution.status!=='resolved'){
       setSession(null);setAuthReady(true);
       return;
     }
     supabase.auth.getSession().then(({data})=>{if(!cancelled){setSession(data.session);setAuthReady(true)}}).catch(()=>{setSession(null);setAuthReady(true)});
     const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{
       if(cancelled)return;
       setSession(next);setAuthReady(true);
     });
     unsubscribe=()=>subscription.unsubscribe();
   })();
   return()=>{cancelled=true;unsubscribe?.()};
 },[authClientVersion]);

 useEffect(()=>{
   let cancelled=false;
   if(!userId){setAccess(null);setAccessReady(false);setData(emptyData);setWorkspaceLogo(null);return;}
   setAccessReady(false);setError('');
   withTimeout(loadAccessAndBranding(userId),90000,'El servicio de datos sigue recuperándose. Vuelve a intentarlo en unos segundos.')
     .then(({profile,workspaceLogo:nextLogo})=>{if(!cancelled){setAccess(profile);setWorkspaceLogo(nextLogo);setAccessReady(true)}})
     .catch(e=>{if(!cancelled){setAccess(null);setWorkspaceLogo(null);setAccessReady(true);setError(e instanceof Error?e.message:'No se pudo comprobar tu acceso.')}});
   return()=>{cancelled=true};
 },[userId,loadAccessAndBranding]);

 useEffect(()=>{
   if(!userId||!access?.active){setData(emptyData);return;}
   (async()=>{try{await bootstrapUser();await refresh();}catch(e){setError(e instanceof Error?e.message:'Error al inicializar la cuenta.')}})();
 },[userId,access?.active,refresh]);

 useEffect(()=>{
   if(!userId||!access?.active)return;
   const syncBranding=()=>{void refreshWorkspaceBranding();};
   window.addEventListener('focus',syncBranding);
   return()=>window.removeEventListener('focus',syncBranding);
 },[userId,access?.active,refreshWorkspaceBranding]);

 useEffect(()=>{
   if(!accessReady||!access?.active||!allowedPages.length)return;
   if(!startPageApplied.current&&!settingsLoading){
     const initial=effectiveStartPage(preferences.startPage,settings.general.startPage,allowedPages);
     if(initial)setPage(initial);
     startPageApplied.current=true;
     return;
   }
   if(!allowedPages.includes(page))setPage(allowedPages[0]);
 },[accessReady,access,allowedPages,page,preferences.startPage,settings.general.startPage,settingsLoading]);

 if(!authReady) return <div className="fullLoader"><LoaderCircle className="spin"/> Cargando…</div>;
 if(recoveryToken) return <><ToastHost/><RecoveryTokenSetup tokenHash={recoveryToken} onComplete={async()=>{
   const url=new URL(window.location.href);
   url.searchParams.delete('recovery_token');
   window.history.replaceState({},document.title,url.pathname+url.search+url.hash);
   const {data}=await supabase.auth.getSession();
   setSession(data.session);
   setAccessReady(false);
 }}/></>;
 if(inviteToken) return <><ToastHost/><InviteTokenSetup tokenHash={inviteToken} onComplete={async()=>{
   const url=new URL(window.location.href);
   url.searchParams.delete('invite_token');
   window.history.replaceState({},document.title,url.pathname+url.search+url.hash);
   const {data}=await supabase.auth.getSession();
   setSession(data.session);
   setAccessReady(false);
 }}/></>;
 if(!session) return <><ToastHost/><AuthScreen initialMessage={tenantBootstrapError} onTenantChanged={()=>{setTenantBootstrapError('');setAuthClientVersion(value=>value+1)}}/></>;
 if(session.user.user_metadata?.onboarding_pending===true) return <><ToastHost/><InvitePasswordSetup session={session} onComplete={async()=>{
   const {data}=await supabase.auth.getSession();
   setSession(data.session);
   setAccessReady(false);
 }}/></>;
 if(!accessReady) return <><ToastHost/><div className="fullLoader"><LoaderCircle className="spin"/> Comprobando acceso…</div></>;
 if(access&&!['active','trialing'].includes(access.workspaceStatus)) return <><ToastHost/><div className="authPage"><div className="authPanel accessDeniedPanel"><div className="authHeroIcon"><LockKeyhole/></div><h1>{access.workspaceStatus==='suspended'?'Empresa suspendida':'Servicio cancelado'}</h1><p>{access.workspaceStatus==='suspended'?'El acceso de tu empresa a ZENVIA Gestión está suspendido temporalmente. Contacta con soporte para reactivarlo.':'La suscripción de tu empresa ya no está activa. Contacta con soporte si necesitas recuperar el acceso.'}</p><div className="actions"><button className="secondary" onClick={()=>supabase.auth.signOut()}>Cerrar sesión</button></div></div></div></>;
 if(!access||!access.active||!allowedPages.length) return <><ToastHost/><div className="authPage"><div className="authPanel accessDeniedPanel"><div className="authHeroIcon"><LockKeyhole/></div><h1>{error?'No se pudo cargar el acceso':'Acceso no autorizado'}</h1><p>{error?error:access&&!access.active?'Tu acceso a ZENVIA Gestión está desactivado.':'Esta cuenta no está autorizada para utilizar ZENVIA Gestión. Contacta con el administrador.'}</p><div className="actions">{error&&<button className="primary" onClick={()=>{setAccessReady(false);setError('');withTimeout(loadAccessAndBranding(session.user.id),90000,'El servicio de datos sigue recuperándose. Vuelve a intentarlo en unos segundos.').then(({profile,workspaceLogo:nextLogo})=>{setAccess(profile);setWorkspaceLogo(nextLogo);setAccessReady(true)}).catch(e=>{setAccess(null);setWorkspaceLogo(null);setAccessReady(true);setError(errorMessage(e,'No se pudo comprobar tu acceso.'))})}}>Reintentar</button>}<button className="secondary" onClick={()=>supabase.auth.signOut()}>Cerrar sesión</button></div></div></div></>;

 const navigate=async(next:Page,options?:{pendingOrders?:boolean})=>{
   if(!allowedPages.includes(next))return;
   if(page==='settings'&&next!=='settings'&&settingsDirty){
     const confirmed=await confirmAction({title:'Cambios sin guardar',message:'Tienes cambios sin guardar en Configuración.',confirmLabel:'Descartar cambios',tone:'warning',details:['Si continúas, los cambios realizados se perderán.']});
     if(!confirmed)return;
     setSettingsDirty(false);
   }
   startPageApplied.current=true;
   if(next==='orders')setOrdersPendingEntry(Boolean(options?.pendingOrders));
   else setOrdersPendingEntry(false);
   setPage(next);
 };
 const changeTheme=(next:ThemeMode)=>{
   if(next===theme)return;
   setTheme(next);
   void patchPreferences({theme:next}).catch(e=>showError(errorMessage(e,'No se pudo guardar el tema.')));
 };
 const toggleTheme=()=>changeTheme(theme==='dark'?'light':'dark');
 const runAction=async(work:()=>Promise<void>,fallback:string)=>{
   try{await work()}
   catch(e){throw new Error(errorMessage(e,fallback));}
 };
 const saveInvoice=async(input:NewInvoiceInput)=>{
   if(!can('invoices'))throw new Error('No tienes permiso para crear facturas de gastos.');
   await runAction(async()=>{await createInvoice(input);await refresh()},'No se pudo guardar la factura.');
 };
 const saveBulkInvoice=async(input:NewInvoiceInput)=>{
   if(!can('invoices'))throw new Error('No tienes permiso para crear facturas de gastos.');
   await createInvoice(input);
 };
 const finishBulkImport=async()=>{await refresh();showSuccess('Importación masiva finalizada.');};
 const changeStatus=async(id:string,status:'pending'|'reviewed'|'accounted')=>{
   if(!can('invoices'))throw new Error('No tienes permiso para modificar facturas.');
   await runAction(async()=>{await updateInvoiceStatus(id,status);await refresh()},'No se pudo cambiar el estado de la factura.');
 };
 const changeInvoiceSupplier=async(invoiceId:string,supplierId:string)=>{
   if(!can('invoices'))throw new Error('No tienes permiso para modificar facturas.');
   await runAction(async()=>{await updateInvoiceSupplier(invoiceId,supplierId);await refresh()},'No se pudo cambiar el proveedor de la factura.');
 };
 const changeInvoiceCategory=async(invoiceId:string,categoryId:string)=>{
   if(!can('invoices'))throw new Error('No tienes permiso para modificar facturas.');
   await runAction(async()=>{await updateInvoiceCategory(invoiceId,categoryId);await refresh()},'No se pudo cambiar la categoría de la factura.');
 };
 const removeInvoice=async(invoice:Invoice)=>{
   if(!can('invoices'))throw new Error('No tienes permiso para eliminar facturas.');
   await runAction(async()=>{await deleteInvoiceWithGmailRecovery(invoice.id,invoice.filePath);await refresh()},'No se pudo eliminar la factura.');
 };
 const openInvoice=async(invoice:Invoice)=>{
   if(!invoice.filePath) throw new Error('Esta factura no tiene un documento asociado.');
   const url=await getInvoiceFileUrl(invoice.filePath);
   const a=document.createElement('a');
   a.href=url;a.target='_blank';a.rel='noopener noreferrer';
   document.body.appendChild(a);a.click();a.remove();
 };
 const openNewProduct=()=>{if(can('products')){setProductToEdit(null);setProductModal(true)}};
 const openEditProduct=(product:Product)=>{if(can('products')){setProductToEdit(product);setProductModal(true)}};
 const closeProductModal=()=>{setProductModal(false);setProductToEdit(null)};
 const saveProduct=async(input:ProductInput)=>{
   if(!can('products'))throw new Error('No tienes permiso para modificar productos.');
   await runAction(async()=>{
     if(productToEdit) await updateProduct(productToEdit.id,input); else await addProduct(input);
     await refresh();
   },'No se pudo guardar el producto.');
 };
 const removeProduct=async(product:Product)=>{
   if(!can('products'))throw new Error('No tienes permiso para eliminar productos.');
   await runAction(async()=>{await deleteProduct(product.id);await refresh()},'No se pudo eliminar el producto.');
 };
 const openNewSupplier=()=>{if(can('suppliers')){setSupplierToEdit(null);setSupplierModal(true)}};
 const openEditSupplier=(supplier:Supplier)=>{if(can('suppliers')){setSupplierToEdit(supplier);setSupplierModal(true)}};
 const closeSupplierModal=()=>{setSupplierModal(false);setSupplierToEdit(null)};
 const saveSupplier=async(input:SupplierInput)=>{
   if(!can('suppliers'))throw new Error('No tienes permiso para modificar proveedores.');
   await runAction(async()=>{
     if(supplierToEdit) await updateSupplier(supplierToEdit.id,input); else await addSupplier(input);
     await refresh();
   },'No se pudo guardar el proveedor.');
 };
 const removeSupplier=async(supplier:Supplier)=>{
   if(!can('suppliers'))throw new Error('No tienes permiso para eliminar proveedores.');
   await runAction(async()=>{await deleteSupplier(supplier.id);await refresh()},'No se pudo eliminar el proveedor.');
 };
 const handleAgentAction=(action:AppAgentAction)=>{
   if(action.type==='navigate'&&action.target&&allowedPages.includes(action.target as Page)){
     void navigate(action.target as Page);
     return;
   }
   if(action.type==='open_settings'&&allowedPages.includes('settings')){void navigate('settings');return;}
   if(action.type==='open_expense_upload'&&can('invoices')){void navigate('invoices');setUpload(true);return;}
   if(action.type==='open_product_create'&&can('products')){void navigate('products');openNewProduct();return;}
   if(action.type==='open_supplier_create'&&can('suppliers')){void navigate('suppliers');openNewSupplier();}
 };

 return <div className="app"><ToastHost/><AppAgent
   allowedPages={allowedPages}
   currentPage={page}
   context={{
     expenseInvoices:data.invoices.length,
     products:data.products.length,
     suppliers:data.suppliers.length,
     workspace:access.workspaceName,
     role:access.role,
   }}
   onAction={handleAgentAction}
 /><Sidebar page={page} onChange={next=>void navigate(next)} onLogout={()=>supabase.auth.signOut()} theme={theme} onThemeChange={changeTheme} allowedPages={allowedPages} isAdmin={access.role==='admin'} user={{fullName:access.fullName,email:access.email||session.user.email||'',role:access.role}} logoSrc={workspaceLogo}/><main className={passkeySetupVisible?'hasPasskeySetup':''}>
   <button className="mobileLogoutButton" onClick={()=>supabase.auth.signOut()} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={19}/></button>
   <button className="mobileThemeToggle" onClick={toggleTheme} title={theme==='dark'?'Cambiar a modo claro':'Cambiar a modo oscuro'} aria-label={theme==='dark'?'Cambiar a modo claro':'Cambiar a modo oscuro'}>{theme==='dark'?<Sun size={19}/>:<Moon size={19}/>}</button>
   <PasskeySetup userId={session.user.id} onVisibilityChange={setPasskeySetupVisible}/>
   <AlertCenter
     notifications={settings.notifications}
     invoices={data.invoices}
     products={data.products}
     suppliers={data.suppliers}
     onNavigate={next=>void navigate(next as Page)}
     canNavigate={next=>allowedPages.includes(next as Page)}
   />
   {error&&<div className="globalError">{error}<button onClick={refresh}>Reintentar</button></div>}
   {page==='dashboard'&&can('dashboard')&&<Dashboard invoices={data.invoices} products={data.products} suppliers={data.suppliers} onUpload={can('invoices')?()=>setUpload(true):undefined} onProducts={can('products')?()=>void navigate('products'):undefined} onOrders={can('orders')?()=>void navigate('orders',{pendingOrders:true}):undefined}/>} 
   {page==='sales'&&can('sales')&&<SalesInvoices/>}
   {page==='orders'&&can('orders')&&<Orders pendingOnly={ordersPendingEntry}/>} 
   {page==='invoices'&&can('invoices')&&<ExpenseInvoicesHub invoices={data.invoices} suppliers={data.suppliers} categories={data.categories} onUpload={()=>setUpload(true)} onBulkUpload={()=>setBulkUpload(true)} onStatusChange={changeStatus} onOpenFile={openInvoice} onDelete={removeInvoice} onSupplierChange={changeInvoiceSupplier} onCategoryChange={changeInvoiceCategory} onImported={refresh}/>} 
   {page==='clients'&&can('clients')&&<Clients/>}
   {page==='products'&&can('products')&&<Products products={data.products} onAdd={openNewProduct} onEdit={openEditProduct} onDelete={removeProduct}/>} 
   {page==='suppliers'&&can('suppliers')&&<Suppliers suppliers={data.suppliers} onAdd={openNewSupplier} onEdit={openEditSupplier} onDelete={removeSupplier}/>} 
   {page==='amazon'&&can('amazon')&&<AmazonPage isAdmin={access.role==='admin'}/>} 
   {page==='support'&&can('support')&&<SupportPage isAdmin={access.role==='admin'} currentUserId={session.user.id}/>} 
   {page==='settings'&&<SettingsPage isAdmin={access.role==='admin'} access={access}/>} 
   {page==='admin'&&access.role==='admin'&&<AdminPage currentUserId={session.user.id} workspaceName={access.workspaceName}/>} 
 </main>
 {can('invoices')&&<UploadInvoiceModal open={upload} onClose={()=>setUpload(false)} onSave={saveInvoice} categories={data.categories} existingInvoices={data.invoices}/>} 
 {can('invoices')&&<BulkInvoiceImportModal open={bulkUpload} onClose={()=>setBulkUpload(false)} categories={data.categories} existingInvoices={data.invoices} onSave={saveBulkInvoice} onFinished={finishBulkImport}/>} 
 {can('products')&&<ProductModal open={productModal} product={productToEdit} suppliers={data.suppliers} onClose={closeProductModal} onSave={saveProduct}/>} 
 {can('suppliers')&&<SupplierModal open={supplierModal} supplier={supplierToEdit} categories={data.categories} onClose={closeSupplierModal} onSave={saveSupplier}/>} 
 </div>
}
