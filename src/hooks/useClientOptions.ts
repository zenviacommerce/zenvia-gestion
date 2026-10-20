import {useCallback,useEffect,useRef,useState} from 'react';
import {loadClients,type Client} from '../services/sales';
import {useEntityRefresh} from './useEntityRefresh';
import {errorMessage} from '../services/toast';
export function useClientOptions(initial:Client[],active=true){
 const [clients,setClients]=useState(initial),[error,setError]=useState('');
 const generation=useRef(0),loadedAt=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const refresh=useCallback(async(search='')=>{
  const current=++generation.current;
  try{const rows=await loadClients(search);if(current!==generation.current)return;
   setClients(old=>search?[...new Map([...old,...rows].map(row=>[row.id,row])).values()]:rows);setError('');if(!search)loadedAt.current=Date.now();
  }catch(e){if(current===generation.current){loadedAt.current=0;setError(errorMessage(e,'No se pudieron actualizar los clientes.'));}}
 },[]);
 useEffect(()=>{if(active)void refresh();return()=>{generation.current++;clearTimeout(timer.current)}},[active,refresh]);
 useEntityRefresh(['clients'],()=>{if(active)return refresh()});
 const onOpen=()=>{if(Date.now()-loadedAt.current>5000)void refresh()};
 const onSearch=(query:string)=>{clearTimeout(timer.current);generation.current++;timer.current=setTimeout(()=>{void refresh(query)},300)};
 return {clients,error,onOpen,onSearch};
}
