import { PeriodPresetButtons } from './PeriodFilterPanel';
import { RotateCcw } from 'lucide-react';
import type { ExpenseCategory, Invoice, Supplier } from '../types';
import { dateFilterForPreset, filterForPreset, quarterOptions, type InvoiceFilter, type PeriodPreset } from '../services/filters';
import { SearchableSelect } from './forms/SearchableSelect';
import { SelectField } from './forms/SelectField';

export function InvoiceFilters({
  filter,
  onChange,
  invoices,
  suppliers,
  categories = [],
  showSupplier = true,
}: {
  filter: InvoiceFilter;
  onChange: (next: InvoiceFilter) => void;
  invoices: Invoice[];
  suppliers: Supplier[];
  categories?: ExpenseCategory[];
  showSupplier?: boolean;
}) {
  const quarters = quarterOptions(invoices);
  const supplierOptions = suppliers.map(supplier=>({
    value:supplier.id,
    label:supplier.name,
    searchText:[supplier.taxId,supplier.email,supplier.phone,supplier.address].filter(Boolean).join(' '),
  }));
  const periodOptions=[
    {value:'today',label:'Hoy'},
    {value:'current_month',label:'Mes actual'},
    {value:'previous_month',label:'Mes anterior'},
    {value:'current_quarter',label:'Trimestre actual'},
    {value:'current_year',label:'Año actual'},
    {value:'all',label:'Todo el histórico'},
    {value:'custom',label:'Personalizado'},
    ...quarters.map(option=>({value:option.value,label:option.label})),
  ];

  const selectPreset = (preset: PeriodPreset) => {
    if (preset === 'custom') {
      onChange({ ...filter, preset });
      return;
    }
    const range=dateFilterForPreset(preset);
    onChange({ ...filter, ...range, supplierId: showSupplier ? filter.supplierId : '' });
  };

  const setDate = (key: 'from' | 'to', value: string) => {
    onChange({ ...filter, supplierId: showSupplier ? filter.supplierId : '', preset: 'custom', [key]: value });
  };

  return <section className={`invoiceFilterPanel card masterPeriodPanel${showSupplier?'':' noSupplier'}`}>
    <PeriodPresetButtons value={filter.preset} onChange={selectPreset}/>
    <div className="filterGrid">
      <label>Periodo
        <SelectField value={filter.preset} options={periodOptions} onChange={value=>selectPreset(value as PeriodPreset)} ariaLabel="Periodo de facturas"/>
      </label>
      {showSupplier&&<label>Proveedor
        <SearchableSelect
          value={filter.supplierId}
          options={supplierOptions}
          onChange={supplierId=>onChange({...filter,supplierId})}
          allowEmpty
          emptyLabel="Todos los proveedores"
          searchPlaceholder="Buscar proveedor…"
          ariaLabel="Filtrar por proveedor"
        />
      </label>}
      <label>Categoría
        <SelectField value={filter.categoryId} onChange={categoryId=>onChange({...filter,categoryId})} ariaLabel="Filtrar por categoría" options={[{value:'',label:'Todas las categorías'},...categories.map(category=>({value:category.id,label:category.name}))]}/>
      </label>
      <label>Estado
        <SelectField value={filter.status} onChange={status=>onChange({...filter,status})} ariaLabel="Filtrar por estado" options={[{value:'',label:'Todos los estados'},{value:'pending',label:'Pendientes'},{value:'reviewed',label:'Revisadas'},{value:'accounted',label:'Contabilizadas'}]}/>
      </label>
      <label>Pago
        <SelectField value={filter.paymentStatus||''} onChange={paymentStatus=>onChange({...filter,paymentStatus})} ariaLabel="Filtrar por estado de pago" options={[{value:'',label:'Todos los pagos'},{value:'unpaid',label:'Por pagar'},{value:'paid',label:'Pagadas'}]}/>
      </label>
      <label>Origen
        <SelectField value={filter.source} onChange={source=>onChange({...filter,source})} ariaLabel="Filtrar por origen" options={[{value:'',label:'Todos los orígenes'},{value:'manual',label:'Archivo / manual'},{value:'camera',label:'Cámara'},{value:'gmail',label:'Gmail'}]}/>
      </label>
      <label>Desde
        <input type="date" value={filter.from} onChange={event => setDate('from', event.target.value)}/>
      </label>
      <label>Hasta
        <input type="date" value={filter.to} onChange={event => setDate('to', event.target.value)}/>
      </label>
      <button className="filterReset" type="button" onClick={() => onChange(filterForPreset('current_quarter'))} title="Restablecer filtros">
        <RotateCcw size={15}/> Restablecer
      </button>
    </div>
  </section>;
}
