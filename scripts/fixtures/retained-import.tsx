import {useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {RetainedImportPage} from '../../src/components/RetainedImportPage';
import {useImportActivity} from '../../src/components/useImportActivity';
import {ActivityCenter} from '../../src/components/ActivityCenter';
import {getActiveActivities} from '../../src/services/activity';
let mounts=0;
function Import(){const [stage,setStage]=useState('Analizando…'),[value,setValue]=useState('Factura 123');useEffect(()=>{mounts++;return()=>{};},[]);useImportActivity(stage!=='Terminada','Importación de prueba',stage);return <><input value={value} onChange={e=>setValue(e.target.value)}/><button onClick={()=>setStage('Revisión preparada')}>Completar análisis</button><button onClick={()=>setStage('Terminada')}>Guardar</button></>;}
function Fixture(){const [active,setActive]=useState(true);return <><button onClick={()=>setActive(!active)}>Cambiar sección</button><RetainedImportPage active={active}><Import/></RetainedImportPage><ActivityCenter/></>;}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);Object.assign(window,{fixtureRoot:root,fixtureActivities:getActiveActivities,fixtureMounts:()=>mounts});
