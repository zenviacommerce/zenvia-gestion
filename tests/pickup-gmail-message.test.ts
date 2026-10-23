// @vitest-environment node
import {it,expect} from 'vitest';
import {buildGmailPdfMessage} from '../supabase/functions/_shared/gmailPdfMessage';
const input={to:'driver@example.test',cc:'owner@example.test',subject:'Recogida sintética',body:'Adjuntamos el informe.',pdf:new TextEncoder().encode('%PDF-1.4\nSYNTHETIC'),filename:'REC-SYNTHETIC.pdf'};
it('reuses UTF8 MIME and attaches a PDF with optional owner copy',()=>{
 const mime=Buffer.from(buildGmailPdfMessage(input),'base64url').toString('utf8');expect(mime).toContain('To: driver@example.test\r\nCc: owner@example.test');expect(mime).toContain('Content-Type: application/pdf');expect(mime).toContain(Buffer.from(input.pdf).toString('base64'));expect(mime).toContain('=?UTF-8?B?');
});
it.each([{to:'a@example.test\r\nBcc: leak@example.test'},{cc:'invalid'},{subject:'x\r\nHeader: injected'},{filename:'../private.pdf'}])('rejects header/path injection %j',change=>expect(()=>buildGmailPdfMessage({...input,...change})).toThrow());
it('writes deterministic recovery headers and suppresses duplicate owner copy',()=>{const messageId='<zenvia.pickup.synthetic@example.test>',pickupRequestId='synthetic-request';const mime=Buffer.from(buildGmailPdfMessage({...input,to:'OWNER@example.test',cc:'owner@example.test',messageId,pickupRequestId}),'base64url').toString('utf8');expect(mime).not.toMatch(/^Cc:/m);expect(mime).toContain('Message-ID: '+messageId+'\r\nX-Zenvia-Pickup-Request: '+pickupRequestId);const encoded=mime.split('Content-Disposition: attachment; filename="REC-SYNTHETIC.pdf"\r\n\r\n')[1].split('\r\n--')[0];expect(Buffer.from(encoded.replace(/\s/g,''),'base64')).toEqual(Buffer.from(input.pdf))});
it.each([{messageId:'<ok@example.test>\r\nBcc: injected@example.test'},{pickupRequestId:'request\r\nHeader: injected'}])('rejects recovery header injection %j',change=>expect(()=>buildGmailPdfMessage({...input,...change})).toThrow());
