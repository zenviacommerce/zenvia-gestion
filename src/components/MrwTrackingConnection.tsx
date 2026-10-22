import {useState} from 'react';
import {testMrwTrackingAccount} from '../services/integrationAccounts';

export function MrwTrackingCredentialsNotice(){
 return <p className="settingsHelpText settingsFieldWide">El seguimiento utiliza las mismas credenciales SAGEC de esta cuenta: usuario y contraseña guardados de forma cifrada.</p>;
}
const messages:Record<string,string>={
 MRW_TRACKING_OK:'Seguimiento MRW: conexión correcta. No se han modificado estados de pedidos.',
 MRW_CREDENTIALS_REQUIRED:'Faltan el usuario y contraseña SAGEC. Guárdalos en Configurar y vuelve a probar el seguimiento.',
 MRW_TRACKING_PASSWORD_REQUIRED:'Faltan el usuario y contraseña SAGEC. Guárdalos en Configurar y vuelve a probar el seguimiento.',
 MRW_TRACKING_ACCESS_DENIED:'MRW ha denegado el seguimiento. Revisa el usuario y contraseña SAGEC guardados para esta cuenta y vuelve a probar.',
 MRW_TRACKING_REJECTED:'MRW no ha aceptado la consulta de seguimiento. Revisa las credenciales SAGEC de esta cuenta y vuelve a probar.',
 MRW_TRACKING_NO_SHIPMENT:'Todavía no hay una expedición propia de MRW directo para comprobar esta cuenta. Crea una etiqueta y vuelve a probar el seguimiento.',
 MRW_TRACKING_ACCOUNT_NOT_FOUND:'No se encuentra una cuenta MRW disponible para esta prueba.',
 MRW_TRACKING_UNSUPPORTED_PROVIDER:'Esta prueba está disponible únicamente para MRW directo.',
};
export function MrwTrackingTestButton({accountId,disabled,onResult}:{accountId:string;disabled:boolean;onResult:(message:string,ok:boolean)=>void}){
 const [testing,setTesting]=useState(false);
 const test=async()=>{setTesting(true);try{const result=await testMrwTrackingAccount(accountId);onResult(messages[result.code]||'No se pudo comprobar el seguimiento. Inténtalo de nuevo.',result.ok&&result.code==='MRW_TRACKING_OK')}catch{onResult('No se pudo comprobar el seguimiento. Inténtalo de nuevo.',false)}finally{setTesting(false)}};
 return <button type="button" className="secondary" disabled={disabled||testing} onClick={()=>void test()}>{testing?'Probando seguimiento…':'Probar seguimiento'}</button>;
}
