export type ToolDefinition={tool_key:string;enabled?:boolean;permission?:string|null;action_type:'read'|'write'|'destructive';requires_confirmation?:boolean;destructive?:boolean;args_schema?:any;handler?:string};
export type ToolFailure={code:string;error:string;status:number};
export function toolNeedsConfirmation(tool:ToolDefinition){return tool.action_type!=='read'||tool.requires_confirmation===true||tool.destructive===true;}
function matches(value:unknown,schema:any,depth=0):boolean{
  if(!schema||depth>8)return false;
  if(schema.enum&&!schema.enum.includes(value))return false;
  if(schema.type==='string')return typeof value==='string'&&value.trim().length>=(schema.minLength??0)&&value.length<=(schema.maxLength??4000)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
  if(schema.type==='boolean')return typeof value==='boolean';
  if(schema.type==='integer'||schema.type==='number')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isInteger(value))&&value>=(schema.minimum??-Infinity)&&value<=(schema.maximum??Infinity);
  if(schema.type==='array')return Array.isArray(value)&&value.length<=(schema.maxItems??100)&&value.every(item=>matches(item,schema.items,depth+1));
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const record=value as Record<string,unknown>,properties=schema.properties??{};
    if((schema.required??[]).some((key:string)=>!(key in record)))return false;
    return Object.entries(record).every(([key,item])=>Object.hasOwn(properties,key)?matches(item,properties[key],depth+1):schema.additionalProperties===true);
  }
  return false;
}
export function validateToolCall(tool:ToolDefinition|null,args:unknown,permissions:string[],confirmed:boolean):ToolFailure|null{
  if(!tool||tool.enabled===false)return {code:'tool_disabled',error:'Herramienta no habilitada.',status:404};
  if(tool.permission&&!permissions.includes(tool.permission))return {code:'permission_denied',error:'No tienes permiso para ejecutar esta herramienta.',status:403};
  if(!matches(args,tool.args_schema))return {code:'invalid_arguments',error:'Los datos de la acción no son válidos o están incompletos.',status:400};
  if(toolNeedsConfirmation(tool)&&confirmed!==true)return {code:'confirmation_required',error:'Esta acción requiere confirmación explícita.',status:409};
  return null;
}
