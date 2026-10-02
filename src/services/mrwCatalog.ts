export type MrwServiceOption={code:string;name:string};

export const MRW_SERVICE_OPTIONS:MrwServiceOption[]=[
  {code:'0230',name:'MRW Bag 19'},
  {code:'0235',name:'MRW Bag 14'},
  {code:'0480',name:'MRW Caja Express 3 kilos'},
  {code:'0490',name:'MRW Documento 14'},
  {code:'0800',name:'MRW Ecommerce'},
  {code:'0810',name:'MRW Ecommerce Canje'},
  {code:'0300',name:'MRW Económico'},
  {code:'0350',name:'MRW Económico Interinsular'},
  {code:'0450',name:'MRW Express 2 kilos'},
  {code:'0400',name:'MRW Express Documentos'},
  {code:'0370',name:'MRW Marítimo Baleares'},
  {code:'0385',name:'MRW Marítimo Canarias'},
  {code:'0390',name:'MRW Marítimo Interinsular'},
  {code:'0010',name:'MRW Promociones'},
  {code:'0000',name:'MRW Urgente 10'},
  {code:'0015',name:'MRW Urgente 10 Expedición'},
  {code:'0100',name:'MRW Urgente 12'},
  {code:'0105',name:'MRW Urgente 12 Expedición'},
  {code:'0110',name:'MRW Urgente 14'},
  {code:'0115',name:'MRW Urgente 14 Expedición'},
  {code:'0200',name:'MRW Urgente 19'},
  {code:'0205',name:'MRW Urgente 19 Expedición'},
  {code:'0220',name:'MRW Urgente 19 Portugal'},
];

export function mrwServiceName(code:string){
  return MRW_SERVICE_OPTIONS.find(item=>item.code===code)?.name||'';
}
