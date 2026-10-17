export function gmailAccessAllowed(caller:{role:string;permissions:string[]|null},action:string){
  return caller.role==='admin'||(['gmail_list','gmail_token'].includes(action)&&Boolean(caller.permissions?.includes('invoices')));
}

export function legacyGmailMigrationPlan(accounts:any[],target:any){
  if(target.provider!=='gmail'||!target.enabled||!String(target.external_account_id||'').includes('@'))throw new Error('Selecciona una cuenta real de Gmail.');
  const placeholders=accounts.filter(account=>account.owner_id===target.owner_id&&account.provider==='gmail'&&account.external_account_id==='legacy'&&account.credential_source==='session'&&!account.config?.migratedToAccountId);
  return {ids:placeholders.map(account=>account.id),transferDefault:placeholders.some(account=>account.is_default)};
}

export function validateGmailOrigin(origin:string|null,requestedWith:string|null,allowed:string[]){
  if(requestedWith!=='XmlHttpRequest')throw new Error('Solicitud de autorización no válida.');
  if(!origin||!allowed.includes(origin))throw new Error('El origen de la autorización no está permitido.');
  return origin;
}

export function gmailConnectionFromToken(token:any,email:string,now=Date.now()){
  if(!token?.access_token||!email||!Number.isFinite(Number(token.expires_in))||Number(token.expires_in)<=0)throw new Error('Google no devolvió una autorización válida.');
  return {email,accessToken:String(token.access_token),expiresAt:now+Number(token.expires_in)*1000};
}

export function gmailServerConfig(){
  const clientId=Deno.env.get('GOOGLE_CLIENT_ID')?.trim()||'';
  const clientSecret=Deno.env.get('GOOGLE_CLIENT_SECRET')?.trim()||'';
  const allowedOrigins=(Deno.env.get('GMAIL_ALLOWED_ORIGINS')||'https://gestion.zenviacommerce.com,https://gestionzenvia.vercel.app').split(',').map(value=>value.trim()).filter(Boolean);
  return {clientId,clientSecret,allowedOrigins,persistent:Boolean(clientId&&clientSecret)};
}

export async function gmailTokenRequest(body:URLSearchParams){
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const token=await res.json();
  if(!res.ok||token.error)throw new Error(token.error==='invalid_grant'?'Google ha caducado o revocado la autorización. Renueva la cuenta desde Integraciones.':'No se pudo completar la autorización de Google. Contacta con el administrador de Zenvia.');
  return token;
}

export async function gmailProfileEmail(accessToken:string){
  const res=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:`Bearer ${accessToken}`}});
  const profile=await res.json();
  if(!res.ok||!profile.emailAddress)throw new Error('Google no concedió permiso de lectura del buzón.');
  return String(profile.emailAddress).trim().toLowerCase();
}
