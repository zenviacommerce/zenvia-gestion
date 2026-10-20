// Only the owner-approved singular refund label may differ in this review.
export function analyticsReviewJson(value){
 return JSON.stringify(value,(_key,item)=>typeof item==='string'?item.replace(/\b1 reembolsos\b/g,'1 reembolso'):item);
}
