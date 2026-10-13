const API='https://ucokhtztxozxcikrmidv.supabase.co/functions/v1/website-contact';
const PUBLIC_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjb2todHp0eG96eGNpa3JtaWR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNTUzMTIsImV4cCI6MjEwNTkzMTMxMn0.akrtuprAy0ZQtRilCQqw8C-1v0nPkyBC1V4pjb0XtlA";
const headers={'Content-Type':'application/json','apikey':PUBLIC_KEY,'Authorization':'Bearer '+PUBLIC_KEY};
const money=cents=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(cents/100);
fetch(API,{headers,signal:AbortSignal.timeout(5000)}).then(async response=>{
 if(!response.ok)return;
 const data=await response.json();
 for(const plan of data.plans||[]){
  const monthly=document.querySelector('[data-monthly="'+plan.plan_key+'"]');
  const yearly=document.querySelector('[data-yearly="'+plan.plan_key+'"]');
  if(monthly&&Number.isInteger(plan.monthly_price_cents))monthly.textContent=money(plan.monthly_price_cents);
  if(yearly&&Number.isInteger(plan.yearly_price_cents)){yearly.textContent='O '+money(plan.yearly_price_cents)+' al año · pago anual';yearly.hidden=false;}
 }
}).catch(()=>{});
const form=document.getElementById('inquiryForm'),status=document.getElementById('inquiryStatus');
let requestId=crypto.randomUUID();
for(const link of document.querySelectorAll('[data-plan]'))link.addEventListener('click',()=>{
 const select=form.elements.namedItem('plan');select.value=link.dataset.plan;
});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(!form.reportValidity())return;
 const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Enviando…';status.textContent='Guardando tu solicitud…';status.dataset.error='false';
 const fields=new FormData(form),body={name:fields.get('name'),email:fields.get('email'),company:fields.get('company'),plan:fields.get('plan'),message:fields.get('message'),website:fields.get('website'),privacyAccepted:fields.get('privacy')==='on',requestId};
 try{
  const response=await fetch(API,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'No se pudo enviar la solicitud.');
  form.reset();requestId=crypto.randomUUID();status.textContent='✓ Solicitud recibida. Nuestro equipo te responderá en el email indicado.';status.focus();
 }catch(error){status.dataset.error='true';status.textContent=error.name==='TimeoutError'?'La conexión ha tardado demasiado. Puedes reintentar sin duplicar tu solicitud.':error.message||'No se pudo enviar. Inténtalo de nuevo.';status.focus();}
 finally{button.disabled=false;button.textContent='Enviar solicitud →';}
});

