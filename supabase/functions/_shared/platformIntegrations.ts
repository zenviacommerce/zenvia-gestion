type Connection={provider?:string;enabled:boolean;status:string;config?:Record<string,unknown>|null};

export function customerIntegrationSummary<T extends Connection>(items:readonly T[]){
  return items.filter(item=>item.enabled&&item.status!=='disabled'
    &&!item.config?.archivedAt
    &&!(item.provider==='gmail'&&item.config?.migratedToAccountId))
    .map(({config:_config,...item})=>item);
}
