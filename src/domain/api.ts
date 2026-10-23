import type {Role} from './types';
let role:Role='admin';
let renewing:Promise<void>|null=null;
export function setPilotRole(next:Role){role=next;}
/** Renew only an expired local pilot session, never an upstream authentication error. */
export async function apiFetch(input:string,init?:RequestInit):Promise<Response>{
 let response=await fetch(input,init);
 if(response.status!==401||input==='/api/session')return response;
 const body=await response.clone().json().catch(()=>null);
 if(body?.error!=='Start a local session first')return response;
 if(!renewing){renewing=fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})}).then(r=>{if(!r.ok)throw new Error('The local session could not be renewed.');}).finally(()=>{renewing=null;});}
 await renewing;
 response=await fetch(input,init);
 return response;
}
