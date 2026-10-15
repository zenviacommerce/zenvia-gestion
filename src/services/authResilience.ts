export type AuthFailureKind='temporarily-unavailable'|'invalid-session'|'invalid-credentials'|'other';
export function classifyAuthError(error:unknown):AuthFailureKind {
  const value=(error&&typeof error==='object'?error:{}) as {status?:unknown;code?:unknown;message?:unknown;name?:unknown};
  const status=Number(value.status||0);
  const code=String(value.code||'').toLowerCase();
  const message=String(value.message||'').toLowerCase();
  const name=String(value.name||'').toLowerCase();
  if(status===400&&(/invalid login credentials|invalid credentials|wrong password/.test(message)||code==='invalid_credentials'))return 'invalid-credentials';
  if(code==='refresh_token_not_found'||code==='refresh_token_already_used'||code==='session_not_found'||/invalid refresh token|refresh token.*(expired|not found)|session.*(revoked|invalid)/.test(message))return 'invalid-session';
  if(status===429||status>=500||['request_timeout','unexpected_failure','over_request_rate_limit'].includes(code)||/timeout|timed out|deadline|failed to fetch|networkerror|network request|unexpected eof|fetch failed|connection reset/.test(message)||['authdeadlineerror','aborterror','timeouterror'].includes(name))return 'temporarily-unavailable';
  return 'other';
}
export async function retryTransientAuth<T>(operation:()=>Promise<T>,maxRetries=2):Promise<T>{
  for(let attempt=0;;attempt++){
    try{return await operation();}
    catch(error){
      if(classifyAuthError(error)!=='temporarily-unavailable'||attempt>=maxRetries)throw error;
      await new Promise<void>(resolve=>setTimeout(resolve,[500,1000][attempt]??1000));
    }
  }
}
