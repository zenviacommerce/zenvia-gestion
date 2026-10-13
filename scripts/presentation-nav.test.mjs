import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Window} from 'happy-dom';
test('mobile presentation menu opens, closes on navigation and supports Escape',()=>{
 const window=new Window({settings:{enableJavaScriptEvaluation:true}});
 window.document.write(fs.readFileSync('public/presentacion.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,''));
 window.eval(fs.readFileSync('public/presentation-nav.js','utf8'));
 const button=window.document.querySelector('.navToggle');const menu=window.document.getElementById('presentationNav');
 button.click();assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(menu.classList.contains('isOpen'),true);
 menu.querySelector('a').click();assert.equal(button.getAttribute('aria-expanded'),'false');
 button.click();window.document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));
 assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(window.document.activeElement,button);
 window.happyDOM.abort();
});
