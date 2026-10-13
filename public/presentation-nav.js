(()=>{
  const button=document.querySelector('.navToggle');
  const menu=document.getElementById('presentationNav');
  if(!button||!menu)return;
  const setOpen=open=>{
    menu.classList.toggle('isOpen',open);
    button.setAttribute('aria-expanded',String(open));
    button.setAttribute('aria-label',open?'Cerrar menú':'Abrir menú');
    button.textContent=open?'×':'☰';
  };
  button.addEventListener('click',()=>setOpen(button.getAttribute('aria-expanded')!=='true'));
  menu.addEventListener('click',event=>{if(event.target.closest('a'))setOpen(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&button.getAttribute('aria-expanded')==='true'){setOpen(false);button.focus();}});
  document.addEventListener('click',event=>{if(!event.target.closest('.nav'))setOpen(false);});
})();
