import type {ReactNode} from 'react';
export function StatusBadge({tone='neutral',children}:{tone?:'neutral'|'warning'|'success';children:ReactNode}){return <span className="dsStatusBadge" data-tone={tone}>{children}</span>}
