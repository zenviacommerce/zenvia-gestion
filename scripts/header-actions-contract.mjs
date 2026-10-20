// Compare rendered actions, including ones installed by production enhancements/portals.
export function assertHeaderActionsPreserved(before,after,context='header'){
 const clean=value=>String(value).replace(/\s+/g,' ').trim();
 const available=after.map(clean),missing=[];
 for(const action of before.map(clean)){const index=available.indexOf(action);if(index<0)missing.push(action);else available.splice(index,1);}
 if(missing.length)throw new Error(`${context}: missing header action(s): ${missing.join(' | ')}`);
}
