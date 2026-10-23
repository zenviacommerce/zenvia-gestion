export type PickupPdfImage={data:string|{data:Uint8ClampedArray;width:number;height:number};format:string;alias:string;width:number;height:number};
export function pickupPdfImage(doc:any,dataUrl:string):PickupPdfImage;
