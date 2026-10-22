import {useState} from 'react';
import {testMrwTrackingAccount} from '../services/integrationAccounts';

export function MrwTrackingPasswordField({value,onChange,editing=false}:{value:string;onChange:(value:string)=>void;editing?:boolean}){
 return <label className="settingsField"><span>Contraseña de seguimiento</span><input aria-label="Contraseña de seguimiento" type="password" autoComplete="new-password" value={value} onChange={e=>onChange(e.target.value)} placeholder={editing?'Sin cambios':'Facilitada por tu franquicia MRW'}/><small>Solicita a tu franquicia el alta del Web Service de seguimiento (opción 4). Es una contraseña independiente de SAGEC para esta cuenta y se guarda cifrada. {editing?'Déjala vacía para conservar la actual.':'Puedes crear etiquetas sin configurar todavía el seguimiento.'}</small></label>;
}
const messages:Record<string,string>={
 MRW_TRACKING_OK:'Seguimiento MRW: conexión correcta. No se han modificado estados de pedidos.',
 MRW_TRACKING_PASSWORD_REQUIRED:'Falta la contraseña de seguimiento. Solicita a tu franquicia el alta del Web Service (opción 4) y guárdala en Configurar. Puedes seguir creando etiquetas con SAGEC.',
 MRW_TRACKING_ACCESS_DENIED:'MRW ha denegado el seguimiento. Confirma con tu franquicia el alta (opción 4) y las credenciales de seguimiento. Las etiquetas SAGEC siguen siendo independientes.',
 MRW_TRACKING_REJECTED:'MRW no ha aceptado la consulta de seguimiento. Confirma con tu franquicia la habilitación y las credenciales del servicio.',
 MRW_TRACKING_NO_SHIPMENT:'Todavía no hay una expedición propia de MRW directo para comprobar esta cuenta. Crea una etiqueta y vuelve a probar el seguimiento.',
 MRW_TRACKING_ACCOUNT_NOT_FOUND:'No se encuentra una cuenta MRW disponible para esta prueba.',
 MRW_TRACKING_UNSUPPORTED_PROVIDER:'Esta prueba está disponible únicamente para MRW directo.',
};
export function MrwTrackingTestButton({accountId,disabled,onResult}:{accountId:string;disabled:boolean;onResult:(message:string,ok:boolean)=>void}){
 const [testing,setTesting]=useState(false);
 const test=async()=>{setTesting(true);try{const result=await testMrwTrackingAccount(accountId);onResult(messages[result.code]||'No se pudo comprobar el seguimiento. Inténtalo de nuevo.',result.ok&&result.code==='MRW_TRACKING_OK')}catch{onResult('No se pudo comprobar el seguimiento. Inténtalo de nuevo.',false)}finally{setTesting(false)}};
 return <button type="button" className="secondary" disabled={disabled||testing} onClick={()=>void test()}>{testing?'Probando seguimiento…':'Probar seguimiento'}</button>;
}
