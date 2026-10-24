// Compare rendered actions, including ones installed by production enhancements/portals.
export function assertHeaderActionsPreserved(before,after,context='header'){
 const clean=value=>String(value).replace(/\s+/g,' ').trim();
 const available=after.map(clean),missing=[];
 for(const action of before.map(clean)){const index=available.indexOf(action);if(index<0)missing.push(action);else available.splice(index,1);}
 if(missing.length)throw new Error(`${context}: missing header action(s): ${missing.join(' | ')}`);
}

// Shared SearchField adds the search type and an accessible name from the unchanged
// placeholder. Keep every other field, action, label and disabled state exact.
export function normalizeListSearchControls(controls){return controls.map(control=>control.tag==='INPUT'&&/^(buscar|search)/i.test(control.placeholder||'')&&[null,'text','search'].includes(control.type)?{...control,type:'search',label:control.label??control.placeholder}:control)}

// Declared addition in the VERI*FACTU action inventory; every baseline action/control remains exact.
export function normalizeBillingIntegrityAddition(before,after,screen){
 const clean=value=>String(value).replace(/\s+/g,' ').trim();
 const matches=value=>typeof value==='string'?clean(value)==='Integridad sombra':value.tag==='BUTTON'&&clean(value.text)==='Integridad sombra';
 if(screen!=='billing'||before.some(matches))return after;
 const added=after.filter(matches);
 if(added.length!==1)throw new Error('Expected exactly one declared Integridad sombra action');
 const item=added[0];
 if(typeof item!=='string'&&(item.disabled!==false||item.label!==null||item.placeholder!==null||![null,'button'].includes(item.type)))throw new Error('Declared integrity action metadata changed');
 return after.filter(value=>!matches(value));
}
