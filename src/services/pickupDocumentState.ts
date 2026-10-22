export const pickupStatusLabel=(status?:string)=>({pending:'Pendiente',partial:'Parcialmente firmado',signed:'Firmado',void:'Anulado'}[status||'pending']||'Pendiente');
