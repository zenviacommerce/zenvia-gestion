import test from 'node:test';import assert from 'node:assert/strict';
import {analyticsReviewJson} from './design-text-parity.mjs';
test('allows the approved singular inside nested multiline card text only',()=>{
 assert.equal(analyticsReviewJson([{text:'Hoy\n1 reembolsos\n23,98 €'}]),analyticsReviewJson([{text:'Hoy\n1 reembolso\n23,98 €'}]));
 assert.notEqual(analyticsReviewJson([{text:'11 reembolsos'}]),analyticsReviewJson([{text:'11 reembolso'}]));
 assert.notEqual(analyticsReviewJson([{text:'1 reembolsos\n23,98 €'}]),analyticsReviewJson([{text:'1 reembolso\n24,98 €'}]));
});
