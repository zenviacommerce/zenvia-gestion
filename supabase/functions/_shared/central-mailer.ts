type CentralMailerBaseInput={
  to:string;
  fullName:string;
  workspaceName:string;
  app:'gestion'|'platform';
};

type CentralInviteInput=CentralMailerBaseInput&{
  inviteUrl:string;
  roleLabel:string;
};

type CentralRecoveryInput=CentralMailerBaseInput&{
  recoveryUrl:string;
};

type CentralBillingInvoiceInput=CentralMailerBaseInput&{
  invoiceNumber:string;
  issueDate:string;
  total:string;
  currency:string;
  pdfBase64:string;
  fileName:string;
};

function clean(value:unknown,max=500){
  return typeof value==='string'?value.trim().slice(0,max):'';
}

async function resolveCentralMailer(controlAdmin:any){
  const {data:settings,error:settingsError}=await controlAdmin.from('platform_infrastructure_settings')
    .select('shared_supabase_url,shared_anchor_workspace_id')
    .eq('singleton',true).maybeSingle();
  if(settingsError)throw settingsError;

  const mailerUrl=clean(settings?.shared_supabase_url,300).replace(/\/$/,'');
  const anchorWorkspaceId=clean(settings?.shared_anchor_workspace_id,80);
  if(!mailerUrl||!anchorWorkspaceId)throw new Error('La infraestructura compartida no tiene configurado el servicio central de correo.');

  const {data:token,error:tokenError}=await controlAdmin.rpc('platform_get_vault_secret',{
    p_name:`customer_bridge_token_${anchorWorkspaceId}`,
  });
  if(tokenError)throw tokenError;
  const bridgeToken=clean(token,1000);
  if(!bridgeToken)throw new Error('Falta el token seguro del servicio central de correo.');
  return {mailerUrl,bridgeToken};
}

async function sendCentralMail(controlAdmin:any,payload:Record<string,unknown>,fallback:string){
  const {mailerUrl,bridgeToken}=await resolveCentralMailer(controlAdmin);
  const response=await fetch(`${mailerUrl}/functions/v1/platform-mailer`,{
    method:'POST',
    headers:{'x-platform-token':bridgeToken,'Content-Type':'application/json'},
    body:JSON.stringify(payload),
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result?.delivered!==true){
    throw new Error(String(result?.error||result?.reason||fallback));
  }
  return {delivered:true,provider:String(result?.provider||'resend')};
}

export async function sendCentralInvite(controlAdmin:any,input:CentralInviteInput){
  return sendCentralMail(controlAdmin,{
    event:'invite',
    to:input.to,
    fullName:input.fullName,
    workspaceName:input.workspaceName,
    inviteUrl:input.inviteUrl,
    roleLabel:input.roleLabel,
    app:input.app,
  },'No se pudo enviar el correo de invitación de ZENVIA.');
}

export async function sendCentralRecovery(controlAdmin:any,input:CentralRecoveryInput){
  return sendCentralMail(controlAdmin,{
    event:'recovery',
    to:input.to,
    fullName:input.fullName,
    workspaceName:input.workspaceName,
    recoveryUrl:input.recoveryUrl,
    app:input.app,
  },'No se pudo enviar el correo de recuperación de contraseña de ZENVIA.');
}

export async function sendCentralBillingInvoice(controlAdmin:any,input:CentralBillingInvoiceInput){
  return sendCentralMail(controlAdmin,{
    event:'billing_invoice',
    to:input.to,
    fullName:input.fullName,
    workspaceName:input.workspaceName,
    invoiceNumber:input.invoiceNumber,
    issueDate:input.issueDate,
    total:input.total,
    currency:input.currency,
    pdfBase64:input.pdfBase64,
    fileName:input.fileName,
    app:input.app,
  },'No se pudo enviar la factura de suscripción de ZENVIA.');
}

export async function sendCentralWebsiteInquiry(controlAdmin:any,input:{id:string;name:string;email:string;company:string;message:string;plan_key:string}){
  return sendCentralMail(controlAdmin,{event:'website_inquiry',inquiryId:input.id,name:input.name,email:input.email,company:input.company,message:input.message,plan:input.plan_key},'No se pudo notificar la consulta de la web.');
}

