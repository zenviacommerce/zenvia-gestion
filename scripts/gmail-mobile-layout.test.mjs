import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Gmail mobile gives invoice content a full row after checkbox and icon',()=>{
 const css=fs.readFileSync('src/gmail-mobile.css','utf8');
 assert.match(css,/\.gmailImportRow\s*\.gmailImportMain\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
 assert.match(css,/\.gmailImportRow\s*\.gmailImportMain\s*\{[^}]*min-width:\s*0/);
});

test('expense Gmail tabs remain within mobile width despite shared overrides',()=>{
 const css=fs.readFileSync('src/responsive-hardening.css','utf8');
 assert.match(css,/\.expenseInvoicesHub\s+\.expenseHubNav\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
 assert.match(css,/\.expenseInvoicesHub\s+\.expenseHubNav\s*\{[^}]*width:\s*100%\s*!important/);
});
