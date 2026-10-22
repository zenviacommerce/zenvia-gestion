import {jsPDF} from 'npm:jspdf@2.5.1';
import {createAdminClient,requireInternalSecret} from '../_shared/amazon/supabase.ts';
import {purgePickupDocuments} from '../_shared/pickupDocumentPurge.ts';
Deno.serve(async(request:Request)=>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 try{requireInternalSecret(request)}catch{return new Response('Unauthorized',{status:401})}
 try{const result=await purgePickupDocuments(createAdminClient(),(created,fileId)=>{const doc=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});doc.setCreationDate(created);doc.setFileId(fileId);return doc});return new Response(JSON.stringify(result),{status:result.ok?200:503,headers:{'Content-Type':'application/json'}})}catch{return new Response(JSON.stringify({ok:false,code:'PICKUP_PURGE_FAILED'}),{status:503,headers:{'Content-Type':'application/json'}})}
});
