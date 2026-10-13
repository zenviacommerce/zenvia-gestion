export function validateInquiry(body:Record<string,unknown>){
 const text=(key:string,max:number)=>{const value=String(body[key]??'').trim();if(value.length>max)throw new Error('Revisa la longitud de los campos.');return value};
 const name=text('name',120),email=text('email',254).toLowerCase(),company=text('company',160),message=text('message',3000),plan=text('plan',30);
 if(!name||!email||message.length<10)throw new Error('Completa tu nombre, email y una consulta de al menos 10 caracteres.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/[\r\n]/.test(email))throw new Error('Introduce un email válido.');
 if(body.privacyAccepted!==true)throw new Error('Debes confirmar que has leído la política de privacidad.');
 if(!['','starter','pro','business'].includes(plan))throw new Error('Selecciona un plan válido.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.requestId??'')))throw new Error('Vuelve a cargar el formulario e inténtalo de nuevo.');
 return {name,email,company,message,plan,requestId:String(body.requestId)};
}
