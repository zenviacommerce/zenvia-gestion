/** Real Orders component + its server adapter boundary, offline synthetic fixtures. */
export async function verifyOrderSortReset(page,output,width){
 const firstCheckbox=()=>page.locator('.ordersTable tbody .bulkSelectCheckbox input').first();
 // The host review already selected DEMO-001. Add one from the next server page.
 if(!await firstCheckbox().isChecked())await firstCheckbox().check();
 await page.locator('.ordersPager').first().getByRole('button',{name:'Siguiente',exact:true}).click();
 await page.waitForFunction(()=>globalThis.fixtureRequests.at(-1)?.page===1);
 await page.locator('.ordersTable tbody tr').filter({hasText:'DEMO-026'}).first().waitFor();
 await firstCheckbox().check();
 const header=page.locator('.ordersTable thead').getByRole('button',{name:'Pedido',exact:true});
 const requestIs=async(key,direction)=>{
  await page.waitForFunction(({key,direction})=>{const p=globalThis.fixtureRequests.at(-1);return p?.sortKey===key&&p?.sortDirection===direction&&p?.page===0;},{key,direction});
  await page.locator('.ordersTable tbody tr').first().waitFor();
 };
 for(const dir of ['asc','desc']){await header.click();await requestIs('order',dir);}
 await page.getByRole('button',{name:'Restablecer orden',exact:true}).waitFor({state:'visible'});
 await page.locator('.tableSortControls').scrollIntoViewIfNeeded();
 await page.screenshot({path:output+'/sort-active-'+width+'.png'});
 await page.setViewportSize({width:390,height:1000});
 await page.keyboard.press('Escape');
 await page.waitForTimeout(350);
 await page.locator('.tableSortControls').scrollIntoViewIfNeeded();
 if(!await page.getByRole('button',{name:'Restablecer orden',exact:true}).isVisible()||!await page.getByRole('button',{name:'Restablecer orden',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}))throw Error('Sort reset is hidden on mobile');
 await page.screenshot({path:output+'/sort-active-mobile-from-'+width+'.png'});
 await page.setViewportSize({width,height:1000});
 await header.click();await requestIs('orderDate','desc');
 if(await page.getByRole('button',{name:'Restablecer orden',exact:true}).count())throw Error('Reset remains after default is restored');
 const saved=await page.evaluate(()=>localStorage.getItem('zenvia:table-sort:orders'));
 if(saved!==null)throw Error('Stored custom order was not removed');
 await header.click();await requestIs('order','asc');
 await page.getByRole('button',{name:'Restablecer orden',exact:true}).click();await requestIs('orderDate','desc');
 await page.getByRole('button',{name:'Ver selección',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Pedidos seleccionados'});await dialog.waitFor();
 const ids=await page.evaluate(()=>globalThis.fixtureSelections.at(-1));
 if(JSON.stringify([...ids].sort())!==JSON.stringify(['demo-0','demo-25']))throw Error('Selected IDs were lost across sort reset: '+JSON.stringify(ids));
 await page.getByRole('button',{name:'Volver a pedidos',exact:true}).click();
 await page.locator('.ordersTable').scrollIntoViewIfNeeded();
 await page.screenshot({path:output+'/sort-reset-'+width+'.png'});
 return {width,states:['order:asc','order:desc','orderDate:desc'],pageAfterReset:0,selectedIds:ids,storageAfterReset:saved,mobileResetVisible:true};
}
