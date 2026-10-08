import {useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import * as retained from '../../src/components/RetainedImportPage';
let mounts=0;
function Page({remember}:{remember:boolean}){
 const [filter,setFilter]=retained.useFilterState('initial',remember);
 const [review,setReview]=useState('draft');
 useEffect(()=>{mounts++},[]);
 return <><output data-filter>{filter}</output><output data-review>{review}</output><button onClick={()=>setFilter('chosen')}>Filtrar</button><button onClick={()=>setReview('reviewed')}>Revisar</button></>;
}
function Fixture(){const [active,setActive]=useState(true),[remember,setRemember]=useState(false);return <><button onClick={()=>setActive(!active)}>Navegar</button><button onClick={()=>setRemember(!remember)}>Recordar</button><retained.RetainedImportPage active={active}><retained.RetainedImportPage active={true}><Page remember={remember}/></retained.RetainedImportPage></retained.RetainedImportPage></>}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);Object.assign(window,{fixtureRoot:root,fixtureMounts:()=>mounts});
