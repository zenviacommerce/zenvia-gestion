import { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { createAmazonProductAndMapping, deleteAmazonProductMappingItem, loadAmazonProductMappings, loadAmazonProductOptions, setAmazonProductMapping, type AmazonProductMapping, type AmazonProductOption } from '../../services/amazon';
import { errorMessage, showError, showSuccess } from '../../services/toast';
import { confirmAction } from '../../services/actionDialog';

const costLabel=(cost:number|null|undefined,unit?:string|null)=>cost==null?'Sin precio registrado':`${new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:4}).format(cost)}${unit?` / ${unit}`:''}`;

type Props={sellerSku:string;productName?:string|null;defaultFactor?:number;onChanged:()=>void;onCancel?:()=>void};

export function AmazonMappingEditor({sellerSku,productName,defaultFactor=1,onChanged,onCancel}:Props){
  const [creating,setCreating]=useState(false);
  const [draft,setDraft]=useState({name:productName||sellerSku,sku:sellerSku,unit:'ud',cost:'',costFrom:new Date().toLocaleDateString('sv-SE'),factor:String(defaultFactor||1)});
  const [query,setQuery]=useState('');
  const [options,setOptions]=useState<AmazonProductOption[]>([]);
  const [mappings,setMappings]=useState<AmazonProductMapping[]>([]);
  const [productId,setProductId]=useState('');
  const [factor,setFactor]=useState(String(defaultFactor||1));
  const [loading,setLoading]=useState(false);
  const [loadingMappings,setLoadingMappings]=useState(true);

  const refreshMappings=async()=>{
    setLoadingMappings(true);
    try{setMappings(await loadAmazonProductMappings(sellerSku));}
    catch(error){showError(errorMessage(error,'No se pudieron cargar los vínculos actuales.'));}
    finally{setLoadingMappings(false);}
  };

  useEffect(()=>{void refreshMappings();},[sellerSku]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{void loadAmazonProductOptions(query).then(setOptions).catch(()=>setOptions([]));},220);
    return()=>window.clearTimeout(timer);
  },[query]);

  const selected=useMemo(()=>options.find(option=>option.id===productId)||mappings.find(mapping=>mapping.productId===productId)||null,[options,mappings,productId]);
  const editingMapping=useMemo(()=>mappings.find(mapping=>mapping.productId===productId)||null,[mappings,productId]);
  const selectedName=selected?('name' in selected?selected.name:selected.productName):'';
  const selectedSupplier=selected?.supplierName||null;

  const choose=(option:AmazonProductOption)=>{
    setProductId(option.id);
    const current=mappings.find(mapping=>mapping.productId===option.id);
    setFactor(String(current?.consumptionFactor||defaultFactor||1));
  };

  const edit=(mapping:AmazonProductMapping)=>{
    setProductId(mapping.productId);
    setFactor(String(mapping.consumptionFactor||1));
    setQuery(mapping.productName);
  };

  const save=async()=>{
    const numeric=Number(factor);
    if(!productId){showError('Selecciona un producto interno.');return;}
    if(!Number.isFinite(numeric)||numeric<=0){showError('El factor debe ser mayor que 0.');return;}
    setLoading(true);
    try{
      const result=await setAmazonProductMapping({sellerSku,productId,consumptionFactor:numeric});
      if(result.skuAssigned)window.dispatchEvent(new CustomEvent('zenvia:products-changed'));
      showSuccess(editingMapping?'Vínculo actualizado.':result.skuAssigned?'Producto añadido y SKU interno asignado automáticamente.':'Producto añadido al coste de Amazon.');
      await refreshMappings();
      setProductId('');setQuery('');setFactor(String(defaultFactor||1));
      onChanged();
    }catch(error){showError(errorMessage(error,'No se pudo guardar el vínculo.'));}
    finally{setLoading(false);}
  };

  const create=async()=>{
    const unitCost=draft.cost.trim()===''?null:Number(draft.cost.replace(',','.'));
    const numeric=Number(draft.factor);
    if(!draft.name.trim()||!draft.sku.trim()){showError('Indica el nombre y el SKU del producto.');return;}
    if(unitCost!=null&&(!Number.isFinite(unitCost)||unitCost<0)){showError('El coste debe ser igual o superior a cero.');return;}
    if(!Number.isFinite(numeric)||numeric<=0){showError('El factor debe ser mayor que cero.');return;}
    setLoading(true);
    try{
      await createAmazonProductAndMapping({sellerSku,name:draft.name.trim(),sku:draft.sku.trim(),unit:draft.unit.trim()||'ud',unitCost,costFrom:unitCost==null?null:draft.costFrom||null,consumptionFactor:numeric});
      window.dispatchEvent(new CustomEvent('zenvia:products-changed'));
      showSuccess('Producto creado y vinculado automáticamente.');
      await refreshMappings();setCreating(false);setProductId('');setQuery('');onChanged();
    }catch(error){showError(errorMessage(error,'No se pudo crear y vincular el producto.'));}
    finally{setLoading(false);}
  };

  const remove=async(mapping:AmazonProductMapping)=>{
    const confirmed=await confirmAction({title:'Eliminar componente',message:`Se quitará “${mapping.productName}” del coste de ${sellerSku}.`,confirmLabel:'Eliminar componente',tone:'danger'});
    if(!confirmed)return;
    setLoading(true);
    try{
      await deleteAmazonProductMappingItem(sellerSku,mapping.productId);
      showSuccess('Componente eliminado del vínculo.');
      if(productId===mapping.productId){setProductId('');setQuery('');setFactor(String(defaultFactor||1));}
      await refreshMappings();
      onChanged();
    }catch(error){showError(errorMessage(error,'No se pudo eliminar el componente.'));}
    finally{setLoading(false);}
  };

  return <div className="amazonMappingEditor">
    <section className="amazonMappingCurrent">
      <div className="amazonMappingCurrentHead"><div><span className="amazonSectionLabel">COSTE DEL SKU</span><strong>Productos vinculados</strong></div><span className="amazonCountBadge">{mappings.length}</span></div>
      <p className="amazonMappingHint">El coste de Amazon suma todos los componentes vinculados multiplicados por su factor de consumo.</p>
      <div className="amazonMappingCurrentList">
        {mappings.map(mapping=><div className="amazonMappingCurrentRow" key={mapping.id||mapping.productId}>
          <div><strong>{mapping.productName}</strong><small>{mapping.productSku||'Sin SKU'} · {mapping.supplierName?`Proveedor: ${mapping.supplierName}`:'Sin proveedor'} · Factor ×{mapping.consumptionFactor}</small><small>Precio: {costLabel(mapping.unitCost,mapping.costUnit)} · Coste del componente: {costLabel(mapping.unitCost==null?null:mapping.unitCost*mapping.consumptionFactor)}</small></div>
          <div className="amazonMappingRowActions"><button type="button" className="amazonInlineAction" disabled={loading} onClick={()=>edit(mapping)}><Pencil size={13}/>Editar</button><button type="button" className="amazonIconDanger" disabled={loading} onClick={()=>void remove(mapping)} aria-label={`Eliminar ${mapping.productName}`}><Trash2 size={14}/></button></div>
        </div>)}
        {!mappings.length&&!loadingMappings&&<span className="amazonMappingEmpty">Todavía no hay productos internos vinculados.</span>}
        {loadingMappings&&<span className="amazonMappingEmpty">Cargando vínculos…</span>}
      </div>
    </section>

    <div className="amazonMappingPane">
    <div className="amazonMappingActions" role="group" aria-label="Vincular o crear producto">
      <button type="button" className={!creating?'primary':'secondary'} disabled={loading} aria-pressed={!creating} onClick={()=>setCreating(false)}>Vincular existente</button>
      <button type="button" className={creating?'primary':'secondary'} disabled={loading} aria-pressed={creating} onClick={()=>{setDraft({name:productName||sellerSku,sku:sellerSku,unit:'ud',cost:'',costFrom:new Date().toLocaleDateString('sv-SE'),factor:String(defaultFactor||1)});setCreating(true);}}><Plus size={15}/>Crear producto</button>
    </div>
    {creating?<form className="amazonMappingAdd" aria-label="Crear y vincular producto" onSubmit={event=>{event.preventDefault();if(!loading)void create();}}>
      <p className="amazonMappingHint">Se creará en Productos y quedará vinculado a {sellerSku}. Si ya existe, selecciónalo en Vincular existente.</p>
      <label><span>Nombre</span><input name="name" required value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
      <label><span>SKU interno</span><input name="sku" required value={draft.sku} onChange={event=>setDraft({...draft,sku:event.target.value})}/></label>
      <label><span>Unidad base</span><input name="unit" required value={draft.unit} onChange={event=>setDraft({...draft,unit:event.target.value})}/></label>
      <label><span>Coste por unidad sin IVA (€), opcional</span><input name="cost" type="number" min="0" step="any" value={draft.cost} onChange={event=>setDraft({...draft,cost:event.target.value})} placeholder="Sin coste registrado"/></label>
      {draft.cost!==''&&<label><span>Coste válido desde</span><input name="costFrom" type="date" required max={new Date().toLocaleDateString('sv-SE')} value={draft.costFrom} onChange={event=>setDraft({...draft,costFrom:event.target.value})}/></label>}
      <label><span>Factor de consumo</span><input name="factor" type="number" required min="0.000001" step="any" value={draft.factor} onChange={event=>setDraft({...draft,factor:event.target.value})}/></label>
      <p className="amazonMappingHint">El factor indica cuántas unidades del producto interno consume una unidad vendida en Amazon. El coste se aplicará desde la fecha indicada.</p>
      <div className="amazonMappingActions"><button type="submit" className="primary" disabled={loading}>{loading?'Creando…':'Crear y vincular'}</button>{onCancel&&<button type="button" className="secondary" disabled={loading} onClick={onCancel}>Cerrar</button>}</div>
    </form>:<section className="amazonMappingAdd">
      <div className="amazonMappingPicker">
        <label><span>{editingMapping?'Producto a actualizar':'Añadir producto interno'}</span><div className="amazonMappingSearch"><Search size={15}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por nombre o SKU"/></div></label>
        <div className="amazonMappingResults" role="listbox" aria-label="Productos internos">
          {options.map(option=><button type="button" role="option" aria-selected={productId===option.id} className={productId===option.id?'isSelected':''} key={option.id} onClick={()=>choose(option)}><span><strong data-zenvia-tooltip={option.name}>{option.name}</strong><small data-zenvia-tooltip={`${option.sku||'Sin SKU'} · ${option.supplierName||'Sin proveedor'}`} >{option.sku||'Sin SKU'} · {option.supplierName?`Proveedor: ${option.supplierName}`:'Sin proveedor'}</small><small>Precio: {costLabel(option.unitCost,option.costUnit)}</small></span>{productId===option.id&&<Check size={15}/>}</button>)}
          {!options.length&&<span className="amazonMappingEmpty">No hay productos que coincidan.</span>}
        </div>
        {productId&&<div className="amazonMappingSelected">Seleccionado: <strong>{selectedName||'Producto actual'}</strong>{selectedSupplier?<span> · {selectedSupplier}</span>:null}</div>}
      </div>
      {selected&&<p className="amazonMappingHint">Precio: {costLabel(selected.unitCost,selected.costUnit)} · Coste con este factor: {costLabel(selected.unitCost==null||!Number.isFinite(Number(factor))||Number(factor)<=0?null:selected.unitCost*Number(factor))}</p>}
      <label><span>Factor de consumo</span><input type="number" min="0.000001" step="0.01" value={factor} onChange={e=>setFactor(e.target.value)}/></label>
      <div className="amazonMappingActions"><button className="primary" disabled={loading||!productId} onClick={()=>void save()}>{loading?'Guardando…':editingMapping?'Actualizar vínculo':<><Plus size={15}/>Añadir producto</>}</button>{onCancel&&<button className="secondary" disabled={loading} onClick={onCancel}>Cerrar</button>}</div>
    </section>}
    </div>
  </div>;
}
