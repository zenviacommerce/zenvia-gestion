import {createClient} from 'npm:@supabase/supabase-js@2';
import {response,withTimeout,fail,clean,number,asRows,responseMetaError,getAdminKey,authenticate,readVault,enviaAccounts,credentials,enviaJson,workspaceConfig,normalizePhone,enviaStateCode,normalizeEnviaAddress,geocodeRows,bestGeocodeRow,geocodeLookup,geocodeAddress,orderWeightKg,addressNumber,contentName,sender,destination,packageFor,validatePayload,humanCarrier,parseEtaDays,normalizeRate,listCarriers,quoteAccount,trackingOf,shipmentCreatedAt,shipmentDestination,shipmentStatus,shipmentCarrier,shipmentService,normalizeMatchText,shipmentReference,shipmentPrice,monthKeys,syncAccountShipments,bytesToBase64,labelPdf,corsHeaders,headers,carrierCache,geocodeCache} from '../_shared/imports/enviaCore.ts';
import {enqueueOrderImport} from '../_shared/imports/orderAdapters.ts';
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return fail('Método no permitido.',405);
  const url=clean(Deno.env.get('SUPABASE_URL')),key=getAdminKey();
  if(!url||!key)return fail('Configuración del backend no disponible.',500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin);
    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action);

    if(action==='status'){
      const accounts=await enviaAccounts(admin,caller.data_owner_id,clean(body?.integrationAccountId));
      const rows=[] as any[];
      for(const account of accounts){
        const c=await credentials(admin,account);
        rows.push({id:String(account.id),displayName:String(account.display_name||'Envia.com'),environment:c.environment,isDefault:Boolean(account.is_default)});
      }
      return response({ok:true,configured:rows.length>0,accounts:rows});
    }

    if(action==='sync_shipments'){
      const job=await enqueueOrderImport(admin,caller,'envia_shipments',{months:number(body.months,2)},body.integrationAccountId);
      return response({ok:true,configured:true,found:0,synced:0,queued:true,jobId:job.id,accounts:[]});
    }

    const orderId=clean(body?.orderId);
    if(!orderId)return fail('Falta el pedido.');
    const {data:order,error:orderError}=await admin.from('fulfillment_orders').select('*').eq('id',orderId).eq('owner_id',caller.data_owner_id).maybeSingle();
    if(orderError)throw orderError;if(!order)return fail('Pedido no encontrado.',404);

    if(action==='rates'){
      const accounts=await enviaAccounts(admin,caller.data_owner_id,clean(body?.integrationAccountId));
      if(!accounts.length)return response({ok:true,configured:false,options:[],message:'Envia.com no está conectado.',diagnostics:[]});
      const config=await workspaceConfig(admin,caller.data_owner_id);
      const results=await Promise.allSettled(accounts.map((account:any)=>quoteAccount(admin,account,order,config)));
      const options=results.flatMap((result:any)=>result.status==='fulfilled'?result.value.options:[]).sort((a:any,b:any)=>(a.price??Number.MAX_VALUE)-(b.price??Number.MAX_VALUE));
      const diagnostics=results.flatMap((result:any,index:number)=>{
        if(result.status==='rejected')return [{account:String(accounts[index]?.display_name||'Envia.com'),carrier:null,message:result.reason instanceof Error?result.reason.message:String(result.reason)}];
        return result.value.errors.map((item:any)=>({account:String(accounts[index]?.display_name||'Envia.com'),...item}));
      });
      const firstDiagnostic=diagnostics[0]?.message?String(diagnostics[0].message).replace(/^Envia\.com \(\d+\):\s*/,''):'';
      const message=options.length
        ?(diagnostics.length?`${options.length} opciones disponibles; ${diagnostics.length} cotizaciones de transportista no aplican a esta ruta.`:null)
        :(firstDiagnostic?`Envia.com no devolvió tarifas. ${firstDiagnostic}`:'Envia.com no devolvió tarifas para este envío.');
      return response({ok:true,configured:true,options,message,diagnostics});
    }

    if(action==='create_label'){
      if(order.sendcloud_parcel_id||order.shipping_remote_id||order.label_created_at)return fail('Este pedido ya tiene una etiqueta.',409);
      const option=body?.shippingOption||{};
      const accountId=clean(option?.integrationAccountId);
      const accounts=await enviaAccounts(admin,caller.data_owner_id,accountId);
      const account=accounts[0];if(!account)return fail('La cuenta de Envia.com seleccionada no está disponible.',409);
      const config=await workspaceConfig(admin,caller.data_owner_id);
      const c=await credentials(admin,account);
      let origin=sender(config),dest=destination(order);const pkg=packageFor(order,config.shipping);
      validatePayload(origin,dest);
      [origin,dest]=await Promise.all([geocodeAddress(origin),geocodeAddress(dest)]);
      if(!origin.state||!dest.state)return fail('Envia.com no pudo validar la provincia/estado del remitente o destinatario. Revisa los códigos postales.',422);
      const carrier=clean(option?.carrierCode),service=clean(option?.code);
      if(!carrier||!service)return fail('Selecciona un transportista y servicio de Envia.com.');
      const labelSize=clean(config.shipping?.labelSize);
      const printSize=labelSize==='A4'?'PAPER_A4':'PAPER_4X6';
      // Envia.com/Correos Express applies a minimum billable/generated weight
      // of 1 kg for epaq_24. Labels created directly in Envia.com for sub-1 kg
      // parcels are returned by its API with declared_weight/shipment_weight=1.
      // Mirror that provider behavior only for label generation; rating keeps
      // using the real parcel weight.
      const realWeight=Number(pkg.weight);
      const normalizedCarrier=carrier.toLowerCase();
      const normalizedService=service.toLowerCase();
      const correosExpressEpaq24=normalizedCarrier==='correosexpress'&&normalizedService==='epaq_24';
      const generateWeight=correosExpressEpaq24&&realWeight<1?1:realWeight;
      const generatePackage={...pkg,weight:generateWeight};
      let payload:any;
      try{
        const generatePayload={
          origin,destination:dest,packages:[generatePackage],
          settings:{printFormat:'PDF',printSize},
          shipment:{
            type:1,
            carrier,
            service,
            orderReference:clean(order.order_number||order.order_id)||undefined,
          },
        };
        // Correos Express' adapter validates KILOS BULTO lexically as 99999.999.
        // JSON.stringify(1) emits "1", so for this exact adapter case preserve
        // the value as the valid JSON numeric literal 1.000 (not a string).
        let generateBody=JSON.stringify(generatePayload);
        if(correosExpressEpaq24&&realWeight<1){
          const marker='"weight":1';
          const index=generateBody.indexOf(marker);
          if(index>=0)generateBody=generateBody.slice(0,index)+generateBody.slice(index).replace(marker,'"weight":1.000');
        }
        payload=await enviaJson(`${c.shipBase}/ship/generate/`,c.token,{
          method:'POST',
          body:generateBody,
        });
      }catch(error){
        const detail=error instanceof Error?error.message:String(error);
        if(/KILOS BULTO.*FORMATO INCORRECTO|99999\.999/i.test(detail)){
          console.error('ENVIA_CARRIER_WEIGHT_REJECTION',JSON.stringify({
            carrier,service,realWeight,generateWeight,weightUnit:pkg.weightUnit,
            destinationCountry:dest.country,destinationPostalCode:dest.postalCode,
            detail,
          }));
          throw new Error(`Envia.com / ${carrier}: Correos Express rechazó el peso enviado (${generateWeight} kg) para epaq_24.`);
        }
        throw error;
      }
      const rows=asRows(payload);
      const data=rows[0]||(payload?.data&&typeof payload.data==='object'?payload.data:payload);
      const tracking=clean(data?.trackingNumber||data?.tracking_number||data?.tracking);
      const labelUrl=clean(data?.label||data?.labelUrl||data?.label_url||data?.url);
      if(!tracking||!labelUrl)throw new Error('Envia.com no devolvió tracking o PDF de etiqueta.');
      const pdf=await labelPdf(labelUrl);
      const now=new Date().toISOString();
      const generatedPrice=number(data?.totalPrice??data?.total_price,NaN);
      const quotedPrice=option?.price==null?NaN:number(option.price,NaN);
      const price=Number.isFinite(generatedPrice)?generatedPrice:(Number.isFinite(quotedPrice)?quotedPrice:null);
      const currency=clean(data?.currency||option?.currency)||'EUR';
      const patch:any={
        shipping_provider:'envia',
        shipping_remote_id:tracking,
        shipping_label_url:labelUrl,
        shipping_integration_account_id:account.id,
        tracking_number:tracking,
        tracking_url:clean(data?.trackUrl||data?.trackingUrl||data?.tracking_url)||null,
        shipping_option_code:service,
        carrier_code:carrier,
        carrier_name:clean(option?.carrierName)||humanCarrier(carrier),
        shipping_service_name:clean(option?.name)||service,
        shipping_cost_amount:price,
        shipping_cost_currency:price==null?null:currency,
        shipping_cost_source:price==null?null:'provider_actual',
        shipping_cost_recorded_at:price==null?null:now,
        label_created_at:now,
        last_synced_at:now,
      };
      const {error:updateError}=await admin.from('fulfillment_orders').update(patch).eq('id',order.id).eq('owner_id',caller.data_owner_id);
      if(updateError)throw updateError;
      return response({
        parcelId:0,shipmentId:clean(data?.shipmentId)||tracking,trackingNumber:tracking,trackingUrl:patch.tracking_url,
        shippingOptionCode:service,contractId:null,carrierCode:carrier,carrierName:patch.carrier_name,
        shippingServiceName:patch.shipping_service_name,mimeType:pdf.mimeType,base64:pdf.base64,
        provider:'envia',integrationAccountId:String(account.id),labelUrl,
      });
    }

    if(action==='fetch_label'){
      if(order.shipping_provider!=='envia'||!order.shipping_label_url)return fail('Este pedido no tiene una etiqueta de Envia.com.',404);
      const pdf=await labelPdf(String(order.shipping_label_url));
      return response({
        parcelId:0,shipmentId:order.shipping_remote_id||order.tracking_number||null,
        trackingNumber:order.tracking_number||null,trackingUrl:order.tracking_url||null,
        shippingOptionCode:order.shipping_option_code||null,contractId:null,
        carrierCode:order.carrier_code||null,carrierName:order.carrier_name||null,
        shippingServiceName:order.shipping_service_name||null,mimeType:pdf.mimeType,base64:pdf.base64,
        provider:'envia',integrationAccountId:order.shipping_integration_account_id||null,labelUrl:order.shipping_label_url,
      });
    }
    return fail('Acción no válida.');
  }catch(error){
    let message=error instanceof Error?error.message:String(error||'Error interno.');
    if(/not enough money|insufficient (?:balance|funds)|saldo insuficiente/i.test(message)){
      message='Saldo insuficiente en Envia.com. Recarga saldo o revisa el crédito disponible en tu cuenta antes de generar la etiqueta.';
    }
    const status=/Sesión no válida/.test(message)?401:/permiso|desactivado/.test(message)?403:/ya tiene una etiqueta/.test(message)?409:/Saldo insuficiente en Envia\.com/.test(message)?402:500;
    return fail(message,status);
  }
});
