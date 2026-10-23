// Compare rendered actions, including ones installed by production enhancements/portals.
export function assertHeaderActionsPreserved(before,after,context='header'){
 const clean=value=>String(value).replace(/\s+/g,' ').trim();
 const available=after.map(clean),missing=[];
 for(const action of before.map(clean)){const index=available.indexOf(action);if(index<0)missing.push(action);else available.splice(index,1);}
 if(missing.length)throw new Error(`${context}: missing header action(s): ${missing.join(' | ')}`);
}

// Shared SearchField adds the search type and an accessible name from the unchanged
// placeholder. Keep every other field, action, label and disabled state exact.
export function normalizeListSearchControls(controls){return controls.map(({tag,placeholder,...control})=>tag==='INPUT'&&/^(buscar|search)/i.test(placeholder||'')&&[null,'text','search'].includes(control.type)?{...control,type:'search',label:control.label??placeholder}:control)}
