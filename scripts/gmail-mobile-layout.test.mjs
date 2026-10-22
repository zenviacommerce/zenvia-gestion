import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Gmail mobile gives invoice content a full row after checkbox and icon',()=>{
 const css=fs.readFileSync('src/gmail-mobile.css','utf8');
 assert.match(css,/\.gmailImportRow\s*\.gmailImportMain\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
 assert.match(css,/\.gmailImportRow\s*\.gmailImportMain\s*\{[^}]*min-width:\s*0/);
});

test('expense Gmail tabs use the shared horizontal rail without clipping labels',()=>{
 const css=fs.readFileSync('packages/ui/src/styles.css','utf8');
 assert.match(css,/\.dsTabs\{[^}]*overflow-x:auto/);
 assert.match(css,/\.dsTabs>\[role='tab'\]\{[^}]*flex:0 0 auto[^}]*white-space:nowrap/);
 const page=fs.readFileSync('src/pages/ExpenseInvoicesHub.tsx','utf8');assert.match(page,/<Tabs panelId="expense-hub-panel"/);
});
