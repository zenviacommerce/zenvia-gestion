import { FormEvent, useMemo, useRef, useState } from 'react';
import { Bot, LoaderCircle, Send, Sparkles, X } from 'lucide-react';
import { askAppAgent, type AgentAction, type AgentMessage } from '../services/appAgent';

export type AppAgentAction=AgentAction;

export function AppAgent({
  allowedPages,
  currentPage,
  context,
  onAction,
}:{
  allowedPages:string[];
  currentPage:string;
  context:Record<string,unknown>;
  onAction:(action:AppAgentAction)=>Promise<string|null|void>|string|null|void;
}){
  const [open,setOpen]=useState(false);
  const [messages,setMessages]=useState<AgentMessage[]>([
    {role:'assistant',content:'Soy ZENVIA IA. Conozco la aplicación, puedo consultar tus datos y ejecutar acciones dentro de ZENVIA Gestión cuando me lo pidas.'},
  ]);
  const [input,setInput]=useState('');
  const [busy,setBusy]=useState(false);
  const endRef=useRef<HTMLDivElement|null>(null);

  const suggestions=useMemo(()=>{
    if(currentPage==='amazon')return ['¿Cuál es el producto más vendido en Amazon?','Resumen de Amazon este mes','¿Cómo funciona Amazon Analytics?'];
    if(currentPage==='invoices')return ['¿Qué facturas tengo por pagar?','¿Qué gastos tengo pendientes?','¿Cómo funciona Gastos?'];
    return ['¿Qué tengo pendiente ahora?','¿Cómo funciona la aplicación?','¿Cuál es el producto más vendido en Amazon?'];
  },[currentPage]);

  const send=async(text=input)=>{
    const value=text.trim();
    if(!value||busy)return;
    const history=messages.slice(-10);
    setMessages(current=>[...current,{role:'user',content:value}]);
    setInput('');
    setBusy(true);
    queueMicrotask(()=>endRef.current?.scrollIntoView({behavior:'smooth'}));
    try{
      const reply=await askAppAgent({
        message:value,
        history,
        allowedPages,
        context:{...context,currentPage},
      });
      setMessages(current=>[...current,{role:'assistant',content:reply.answer}]);
      if(reply.action?.type&&reply.action.type!=='none'){
        const result=await onAction(reply.action);
        if(typeof result==='string'&&result.trim()){
          setMessages(current=>[...current,{role:'assistant',content:result.trim()}]);
        }
      }
    }catch(error){
      setMessages(current=>[...current,{
        role:'assistant',
        content:error instanceof Error?error.message:'No he podido responder ahora mismo.',
      }]);
    }finally{
      setBusy(false);
      window.setTimeout(()=>endRef.current?.scrollIntoView({behavior:'smooth'}),40);
    }
  };

  const submit=(event:FormEvent)=>{event.preventDefault();void send();};

  return <>
    <button type="button" className="appAgentLauncher" onClick={()=>setOpen(true)} aria-label="Abrir ZENVIA IA">
      <Sparkles size={17}/><span>ZENVIA IA</span>
    </button>
    {open&&<div className="appAgentBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}>
      <aside className="appAgentPanel" aria-label="ZENVIA IA">
        <header className="appAgentHeader">
          <div className="appAgentIdentity"><span className="appAgentAvatar"><Sparkles size={18}/></span><div><strong>ZENVIA IA</strong><small>Especialista en ZENVIA Gestión</small></div></div>
          <button type="button" className="appAgentClose" onClick={()=>setOpen(false)} aria-label="Cerrar ZENVIA IA"><X size={19}/></button>
        </header>
        <div className="appAgentMessages">
          {messages.map((message,index)=><div className={message.role==='user'?'appAgentMessage user':'appAgentMessage assistant'} key={index}>
            {message.role==='assistant'&&<span className="appAgentMessageIcon"><Bot size={15}/></span>}
            <div>{message.content}</div>
          </div>)}
          {busy&&<div className="appAgentMessage assistant"><span className="appAgentMessageIcon"><Bot size={15}/></span><div className="appAgentThinking"><LoaderCircle className="spin" size={15}/> Pensando…</div></div>}
          <div ref={endRef}/>
        </div>
        {!busy&&messages.length<4&&<div className="appAgentSuggestions">
          {suggestions.map(item=><button type="button" key={item} onClick={()=>void send(item)}>{item}</button>)}
        </div>}
        <form className="appAgentComposer" onSubmit={submit}>
          <textarea rows={2} value={input} onChange={event=>setInput(event.target.value)} placeholder="Pregúntame algo o dime qué quieres hacer…" onKeyDown={event=>{
            if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send();}
          }}/>
          <button type="submit" className="primary" disabled={busy||!input.trim()} aria-label="Enviar a ZENVIA IA">
            {busy?<LoaderCircle className="spin" size={17}/>:<Send size={17}/>}
          </button>
        </form>
        <footer className="appAgentFooter">Las operaciones que modifican datos usan la confirmación estándar de ZENVIA antes de ejecutarse.</footer>
      </aside>
    </div>}
  </>;
}
