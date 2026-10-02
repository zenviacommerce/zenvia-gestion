import { useEffect, useState } from 'react';
import { TransportTariffsPanel } from './TransportTariffsPanel';

function normalized(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}

function trackingTranslation(value:string){
  const raw=normalized(value).replace(/[_-]+/g,' ');
  if(!raw)return null;
  if(raw.includes('delivered')||raw.includes('shipment collected by customer'))return 'Entregado';
  if(raw.includes('driver en route')||raw.includes('out for delivery'))return 'En reparto';
  if(raw.includes('awaiting customer pickup'))return 'En punto de recogida';
  if(raw.includes('sorting centre')||raw.includes('sorting center')||raw.includes('being sorted'))return 'En centro de distribución';
  if(raw.includes('parcel en route')||raw.includes('en route to sorting')||raw.includes('picked up by driver')||raw.includes('shipment picked up')||raw.includes('in transit'))return 'En tránsito';
  if(raw.includes('address invalid')||raw.includes('attempt failed')||raw.includes('announcement failed')||raw.includes('unable to deliver')||raw.includes('exception')||raw.includes('error collecting')||raw.includes('refused')||raw.includes('returned to sender')||raw.includes('delivery delayed'))return 'Incidencia';
  if(raw.includes('cancel'))return 'Cancelado';
  if(raw.includes('ready to send')||raw.includes('ready for shipment')||raw.includes('announced')||raw.includes('being announced')||raw.includes('no label'))return 'Preparado';
  if(raw==='pending'||raw==='pending tracking')return 'Pendiente de seguimiento';
  return null;
}

function translateTrackingBadges(){
  document.querySelectorAll<HTMLElement>('.ordersTracking').forEach(badge=>{
    const original=(badge.textContent||'').trim();
    const translated=trackingTranslation(original);
    if(!translated||translated===original)return;
    if(!badge.getAttribute('aria-label'))badge.setAttribute('aria-label',original);
    badge.textContent=translated;
  });
}

export function OrderLabelDefaults(){
  const [tariffsOpen,setTariffsOpen]=useState(false);
  useEffect(()=>{
    const enhance=()=>{
      translateTrackingBadges();
      const actions=document.querySelector<HTMLElement>('.ordersPage .pageHead .actions');
      if(!actions)return;
      let button=actions.querySelector<HTMLButtonElement>('.zenviaTransportTariffsButton');
      if(button)return;
      button=document.createElement('button');
      button.type='button';
      button.className='secondary zenviaTransportTariffsButton';
      button.textContent='Tarifas de transporte';
      button.setAttribute('aria-label','Abrir tarifas de transporte');
      button.onclick=()=>setTariffsOpen(true);
      actions.prepend(button);
    };
    enhance();
    const observer=new MutationObserver(enhance);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    return()=>{
      observer.disconnect();
      document.querySelector('.zenviaTransportTariffsButton')?.remove();
    };
  },[]);
  return <TransportTariffsPanel open={tariffsOpen} onClose={()=>setTariffsOpen(false)}/>;
}
