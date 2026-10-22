// @vitest-environment node
import {it,expect} from 'vitest';
import {buildGmailPdfMessage} from '../supabase/functions/_shared/gmailPdfMessage';
const input={to:'driver@example.test',cc:'owner@example.test',subject:'Recogida sintética',body:'Adjuntamos el informe.',pdf:new TextEncoder().encode('%PDF-1.4\nSYNTHETIC'),filename:'REC-SYNTHETIC.pdf'};
it('reuses UTF8 MIME and attaches a PDF with optional owner copy',()=>{
 const mime=Buffer.from(buildGmailPdfMessage(input),'base64url').toString('utf8');expect(mime).toContain('To: driver@example.test\r\nCc: owner@example.test');expect(mime).toContain('Content-Type: application/pdf');expect(mime).toContain(Buffer.from(input.pdf).toString('base64'));expect(mime).toContain('=?UTF-8?B?');
});
it.each([{to:'a@example.test\r\nBcc: leak@example.test'},{cc:'invalid'},{subject:'x\r\nHeader: injected'},{filename:'../private.pdf'}])('rejects header/path injection %j',change=>expect(()=>buildGmailPdfMessage({...input,...change})).toThrow());
