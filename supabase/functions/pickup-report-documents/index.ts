import {jsPDF} from 'npm:jspdf@2.5.1';
import {createAdminClient,authenticateUser} from '../_shared/amazon/supabase.ts';
import {createPickupDocumentHandler} from '../_shared/pickupDocumentHandler.ts';
Deno.serve(createPickupDocumentHandler({
 admin:createAdminClient(),authenticate:authenticateUser,
 makeDocument:(created,fileId)=>{const doc=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});doc.setCreationDate(created);doc.setFileId(fileId);return doc},
}));
