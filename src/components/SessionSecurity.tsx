import {useRef,useState} from 'react';
import {LogOut} from 'lucide-react';
import {supabase} from '../services/supabase';
import {confirmAction} from '../services/actionDialog';

/** Deliberately global. Ordinary logout controls must always use scope: 'local'. */
export function SessionSecurity(){
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const pending=useRef(false);
 const closeAll=async()=>{
  if(pending.current)return;
  pending.current=true;setBusy(true);setError('');
  try{
   const confirmed=await confirmAction({title:'¿Cerrar sesión en todos los dispositivos?',message:'Se cerrarán todas las sesiones de tu cuenta, incluida la de este dispositivo. Tendrás que volver a iniciar sesión.',confirmLabel:'Cerrar todas las sesiones',tone:'danger'});
   if(!confirmed)return;
   const result=await supabase.auth.signOut({scope:'global'});
   if(result.error)throw result.error;
  }catch{
   setError('No se pudieron cerrar todas las sesiones. Comprueba tu conexión y vuelve a intentarlo.');
  }finally{pending.current=false;setBusy(false)}
 };
 return <section className="settingsSectionCard"><div className="settingsSectionHero"><div className="settingsSectionIcon"><LogOut size={22}/></div><div><h2>Sesiones de tu cuenta</h2><p>Si has perdido un dispositivo o sospechas un acceso ajeno, cierra todas tus sesiones. La salida habitual solo cierra la sesión de este dispositivo.</p></div></div><div className="mfaSettingsBody"><div className="actions"><button type="button" className="secondary" disabled={busy} onClick={()=>void closeAll()}>{busy?'Cerrando sesiones…':'Cerrar sesión en todos los dispositivos'}</button></div>{error&&<p role="alert" className="mfaError">{error}</p>}</div></section>;
}
