import test from 'node:test';import assert from 'node:assert/strict';import {Window} from 'happy-dom';import {mirrorPaginationBars,clearPaginationMirrors} from '../src/services/paginationBars.ts';
test('single native page has no visible controls or mirror',()=>{
 const window=new Window(),before=[globalThis.document,globalThis.HTMLElement];globalThis.document=window.document;globalThis.HTMLElement=window.HTMLElement;
 try{document.body.innerHTML='<section class="tableCard"><table></table><div class="listPagination"><span>Página 1 de 1</span><button disabled>Anterior</button><button disabled>Siguiente</button></div></section>';mirrorPaginationBars();assert.equal(document.querySelector('.listPagination').hidden,true);assert.equal(document.querySelector('.paginationMirror'),null);}
 finally{clearPaginationMirrors();[globalThis.document,globalThis.HTMLElement]=before;window.happyDOM.close();}
});
test('automatic bars surround both desktop and mobile list, without second pagination owner',async()=>{
 const {renderTarget,collectTargets}=await import('../src/services/autoListPagination.ts');const window=new Window(),before=[globalThis.document,globalThis.HTMLElement];globalThis.document=window.document;globalThis.HTMLElement=window.HTMLElement;
 try{const rows=Array.from({length:3},(_,i)=>`<tr><td>${i}</td></tr>`).join('');document.body.innerHTML=`<section class="tableCard"><table><tbody>${rows}</tbody></table></section><div class="genericMobileList"><div>0</div><div>1</div><div>2</div></div>`;const target=collectTargets()[0];renderTarget(target,2);mirrorPaginationBars();assert.equal(document.querySelector('.genericMobileList').nextElementSibling.classList.contains('autoListPagination'),true);assert.equal(document.querySelectorAll('.listPagination').length,2);assert.equal(collectTargets().length,1);}
 finally{clearPaginationMirrors();[globalThis.document,globalThis.HTMLElement]=before;window.happyDOM.close();}
});
test('top controls forward native page actions and synchronize bounds without duplicate mirrors',()=>{
 const window=new Window();const before=[globalThis.document,globalThis.HTMLElement];globalThis.document=window.document;globalThis.HTMLElement=window.HTMLElement;
 try{document.body.innerHTML='<section class="tableCard"><table><tbody><tr><td>Page 1</td></tr></tbody></table><div class="listPagination"><span>Página 1 de 2</span><button disabled>Anterior</button><button>Siguiente</button></div></section>';
 const source=document.querySelector('.listPagination');let calls=0;source.querySelectorAll('button')[1].onclick=()=>{calls++;source.querySelector('span').textContent='Página 2 de 2';source.querySelectorAll('button')[0].disabled=false;source.querySelectorAll('button')[1].disabled=true;document.querySelector('td').textContent='Page 2';};
 mirrorPaginationBars();mirrorPaginationBars();assert.equal(document.querySelectorAll('.paginationMirror').length,1);assert.equal(document.body.firstElementChild.classList.contains('paginationMirror'),true);
 document.querySelector('.paginationMirror button:last-child').click();mirrorPaginationBars();assert.equal(calls,1);assert.match(document.querySelector('.paginationMirror').textContent,/Página 2/);assert.equal(document.querySelector('.paginationMirror button:last-child').disabled,true);assert.equal(document.querySelector('.paginationMirror button').disabled,false);
 document.querySelector('.tableCard').remove();mirrorPaginationBars();assert.equal(document.querySelectorAll('.paginationMirror').length,0);
 }finally{clearPaginationMirrors();[globalThis.document,globalThis.HTMLElement]=before;window.happyDOM.close();}
});
test('Amazon and mobile master tables reuse the original pagination instead of paginating loaded rows twice',()=>{
 const window=new Window(),before=[globalThis.document,globalThis.HTMLElement];globalThis.document=window.document;globalThis.HTMLElement=window.HTMLElement;
 try{document.body.innerHTML='<section class="card amazonTableCard"><table><tbody><tr><td>Server result</td></tr></tbody></table><div class="amazonPagination"><button>Anterior</button><span>Página 3</span><button>Siguiente</button></div></section><section class="tableCard masterTableCard"><table></table></section><div class="masterMobileList"></div><div class="listPagination"><button>Anterior</button><button>Siguiente</button></div>';
 mirrorPaginationBars();assert.equal(document.querySelectorAll('.paginationMirror').length,2);assert.equal(document.querySelector('.masterTableCard').previousElementSibling.classList.contains('paginationMirror'),true);assert.equal(document.querySelector('.amazonTableCard tbody').children.length,1);
 }finally{clearPaginationMirrors();[globalThis.document,globalThis.HTMLElement]=before;window.happyDOM.close();}
});

test('automatic desktop/mobile pagination stays synchronized when either bar changes the page',async()=>{
 const {renderTarget,collectTargets}=await import('../src/services/autoListPagination.ts');const window=new Window(),before=[globalThis.document,globalThis.HTMLElement];globalThis.document=window.document;globalThis.HTMLElement=window.HTMLElement;
 try{document.body.innerHTML='<div class="ordersPage"><section class="ordersTableCard"><table class="ordersTable"><tbody>'+Array.from({length:5},(_,i)=>`<tr><td>Row ${i}</td></tr>`).join('')+'</tbody></table></section><div class="ordersMobileList">'+Array.from({length:5},(_,i)=>`<div>Row ${i}</div>`).join('')+'</div></div>';
 const target=collectTargets()[0];target.anchor.scrollIntoView=()=>{};renderTarget(target,2);mirrorPaginationBars();assert.equal(document.querySelectorAll('.autoListPagination').length,2);
 document.querySelector('.paginationMirror button:last-child').click();mirrorPaginationBars();for(const list of target.containers){assert.deepEqual([...list.children].filter(n=>n.style.display!=='none').map(n=>n.textContent),['Row 2','Row 3']);}
 document.querySelector('.autoListPagination:not(.paginationMirror) button:last-child').click();mirrorPaginationBars();assert.ok([...document.querySelectorAll('.autoListPagination')].every(b=>b.textContent.includes('Página 3 de 3')));
 for(const list of target.containers)while(list.children.length>1)list.lastElementChild.remove();renderTarget(target,2);mirrorPaginationBars();assert.equal(document.querySelectorAll('.autoListPagination').length,0);
 }finally{clearPaginationMirrors();[globalThis.document,globalThis.HTMLElement]=before;window.happyDOM.close();}
});
