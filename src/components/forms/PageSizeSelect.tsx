import { useSettings } from '../../context/SettingsContext';
import { SelectField } from './SelectField';
import { errorMessage, showError } from '../../services/toast';
import type { UserPreferences } from '../../services/settingsSchema';

const options=[10,20,25,50,100].map(value=>({value:String(value),label:String(value)}));
export function PageSizeSelect(){
 const {preferences,patchPreferences}=useSettings();
 return <label className="pageSizeSelect"><span>Filas por página</span><SelectField ariaLabel="Filas por página" value={String(preferences?.pageSize||25)} options={options} onChange={value=>{void patchPreferences({pageSize:Number(value) as UserPreferences['pageSize']}).catch(error=>showError(errorMessage(error,'No se pudo guardar el tamaño de página.')));}}/></label>;
}
