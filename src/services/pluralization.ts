/** Spanish counter text; explicit forms also support accented words and phrases. */
export function countLabel(count:number,singular:string,plural:string){
 return `${count.toLocaleString('es-ES')} ${Math.abs(count)===1?singular:plural}`;
}
