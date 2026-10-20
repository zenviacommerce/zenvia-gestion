export type SharedEntity='clients'|'suppliers'|'products'|'tariffs'|'integrations';
export const ENTITY_CHANGED='zenvia:entity-changed';
// Payload carries no records or credentials; listeners re-read through their own RLS session.
export function notifyEntityChanged(entity:SharedEntity){
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(ENTITY_CHANGED,{detail:entity}));
}
