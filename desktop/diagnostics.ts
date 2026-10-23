import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

export function redactDiagnostic(value:unknown):string {
  return String(value??'').replace(/sk-[a-zA-Z0-9_-]{8,}/g,'[REDACTED_KEY]').replace(/Bearer\s+[^\s,;"']+/gi,'Bearer [REDACTED]').replace(/("(?:password|authorization|api[_ -]?key|access[_ -]?token|secret)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,'$1"[REDACTED]"').replace(/((?:password|authorization|api[_ -]?key|access[_ -]?token|secret)\s*["']?\s*[:=]\s*)[^\n,;]+/gi,'$1[REDACTED]').replace(/\b[a-f0-9]{48,}\b/gi,'[REDACTED_TOKEN]').replace(/\/Users\/[^/\s]+/g,'/Users/[user]').replace(/[A-Z]:\\Users\\[^\\\s]+/gi,'C:\\Users\\[user]').slice(0,1600);
}
export function createDiagnosticLogger(directory:string){
  let queue=Promise.resolve();
  return(event:string,details:Record<string,string|number|boolean|null>={})=>{
    const record={timestamp:new Date().toISOString(),event:redactDiagnostic(event),details:Object.fromEntries(Object.entries(details).map(([key,value])=>[key,typeof value==='string'?redactDiagnostic(value):value]))};
    queue=queue.then(async()=>{await mkdir(directory,{recursive:true,mode:0o700});const filename=path.join(directory,'desktop.log');try{if((await stat(filename)).size>256*1024)await rename(filename,`${filename}.1`);}catch{}await appendFile(filename,`${JSON.stringify(record)}\n`,{mode:0o600});}).catch(()=>{});
    return queue;
  };
}
