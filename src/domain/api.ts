import type {Role} from './types';
let role:Role='admin';
let identityRequired=false;
export function setIdentityMode(value:boolean){identityRequired=value;}
let renewing:Promise<void>|null=null;
export function setPilotRole(next:Role){role=next;}
/** Renew only an expired local pilot session, never an upstream authentication error. */
export async function apiFetch(input:string,init?:RequestInit):Promise<Response>{
 let response=await fetch(input,init);
 if(response.status!==401||input==='/api/session')return response;
 const body=await response.clone().json().catch(()=>null);
 if(identityRequired){if(body?.code==='AUTH_REQUIRED')window.dispatchEvent(new Event('atelier:auth-required'));return response;}
 if(body?.code!=='AUTH_REQUIRED'&&!['Start a local session first','Start a local development session first'].includes(body?.error))return response;
 if(!renewing){renewing=fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})}).then(r=>{if(!r.ok)throw new Error('The local session could not be renewed.');}).finally(()=>{renewing=null;});}
 await renewing;
 response=await fetch(input,init);
 return response;
}

export interface WorkspaceIdentityUser {id:string;name:string;email:string;isAdmin:boolean;createdAt:string}
export interface WorkspaceAuthStatus {identityRequired:boolean;setupRequired:boolean;authenticated:boolean;user:WorkspaceIdentityUser|null}
type StartupCode='CONNECTION_FAILED'|'INVALID_AUTH_STATUS'|'DESKTOP_CAPABILITY_REQUIRED'|'IDENTITY_REQUIRED'|'STORAGE_INTEGRITY'|'ACCESS_INTEGRITY'|'MIGRATION_FAILED'|'ENGINE_ERROR';
const startupMessages:Record<StartupCode,string>={
 CONNECTION_FAILED:'The local project engine could not be reached. Retry; if this continues, quit Atelier completely and reopen the installed app.',
 INVALID_AUTH_STATUS:'The local project engine returned an invalid startup response. Quit Atelier completely and reopen the installed app.',
 DESKTOP_CAPABILITY_REQUIRED:'The desktop connection was not authorized. Quit Atelier completely and reopen the installed app.',
 IDENTITY_REQUIRED:'The desktop engine did not enable protected workspace accounts. Reopen the installed app; local data has not been opened.',
 STORAGE_INTEGRITY:'Local workspace data failed its integrity check. Original data was kept. Restore a verified backup before continuing.',
 ACCESS_INTEGRITY:'Local project permissions could not be verified. Existing permissions were kept. Repair the local access data before continuing.',
 MIGRATION_FAILED:'Existing project data could not be safely upgraded. Original files were kept. Resolve the migration conflict before retrying.',
 ENGINE_ERROR:'The local project engine could not open the workspace. Retry; if this continues, keep the original data and inspect the local diagnostics.',
};
export class WorkspaceStartupError extends Error {
 constructor(public readonly code:StartupCode,public readonly status?:number){super(`${startupMessages[code]} (${code}${status===undefined?'':` · HTTP ${status}`})`);this.name='WorkspaceStartupError';}
}
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
/** Accept only an explicit identity contract; missing flags must never enable development mode. */
export function parseWorkspaceAuthStatus(value:unknown,requireIdentity=false):WorkspaceAuthStatus {
 if(!object(value)||typeof value.identityRequired!=='boolean'||typeof value.setupRequired!=='boolean'||typeof value.authenticated!=='boolean'||!('user'in value))throw new WorkspaceStartupError('INVALID_AUTH_STATUS',200);
 if(requireIdentity&&!value.identityRequired)throw new WorkspaceStartupError('IDENTITY_REQUIRED',200);
 let user:WorkspaceIdentityUser|null=null;
 if(value.user!==null){
  const input=value.user;
  if(!object(input)||typeof input.id!=='string'||!/^user-[A-Za-z0-9_-]{1,155}$/.test(input.id)||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||typeof input.email!=='string'||!input.email||input.email.length>254||typeof input.isAdmin!=='boolean'||typeof input.createdAt!=='string'||input.createdAt.length>80||!Number.isFinite(Date.parse(input.createdAt)))throw new WorkspaceStartupError('INVALID_AUTH_STATUS',200);
  user={id:input.id,name:input.name,email:input.email,isAdmin:input.isAdmin,createdAt:input.createdAt};
 }
 if((value.setupRequired&&(!value.identityRequired||value.authenticated||user!==null))||(value.identityRequired&&value.authenticated!==(user!==null))||(!value.identityRequired&&user!==null))throw new WorkspaceStartupError('INVALID_AUTH_STATUS',200);
 return{identityRequired:value.identityRequired,setupRequired:value.setupRequired,authenticated:value.authenticated,user};
}
/** Startup uses the read-only status endpoint and never renews a client-selected pilot role. */
export async function requestWorkspaceAuthStatus(options:{signal?:AbortSignal;requireIdentity?:boolean}={}):Promise<WorkspaceAuthStatus>{
 let response:Response;
 try{response=await fetch('/api/auth/status',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:options.signal});}
 catch(error){if(options.signal?.aborted)throw error;throw new WorkspaceStartupError('CONNECTION_FAILED');}
 if(!response.ok){
  const body:unknown=await response.json().catch(()=>null),code=object(body)?body.code:undefined;
  const recognized:StartupCode=code==='DESKTOP_CAPABILITY_REQUIRED'||code==='STORAGE_INTEGRITY'||code==='ACCESS_INTEGRITY'||code==='MIGRATION_FAILED'?code:'ENGINE_ERROR';
  throw new WorkspaceStartupError(recognized,response.status);
 }
 const value:unknown=await response.json().catch(()=>{throw new WorkspaceStartupError('INVALID_AUTH_STATUS',response.status);});
 return parseWorkspaceAuthStatus(value,options.requireIdentity);
}
