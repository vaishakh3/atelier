import {parseWorkspaceAuthStatus} from '../src/domain/api';
const messages:Record<string,string>={
 DESKTOP_CAPABILITY_REQUIRED:'The desktop connection could not be authorized. Quit Atelier and open the installed application again.',
 STORAGE_INTEGRITY:'A local record could not be verified. Restore a verified project backup; the original record has not been replaced.',
 ACCESS_INTEGRITY:'Project access information could not be verified. Restore the original workspace or a verified backup.',
 MIGRATION_FAILED:'An older workspace could not be safely upgraded. The original files have been kept for recovery.',
};
export class DesktopStartupError extends Error{
 constructor(public readonly code:string,public readonly status?:number){super(`${messages[code]??'The local project engine could not finish starting. Retry opening Atelier.'} (${code}${status?`, HTTP ${status}`:''})`);this.name='DesktopStartupError';}
}
/** Probe the actual identity/migration route before declaring the desktop ready. */
export async function assertDesktopBackendReady(origin:string,capability:string,request:typeof fetch=fetch):Promise<void>{
 let base:URL;try{base=new URL(origin);}catch{throw new DesktopStartupError('INVALID_DESKTOP_ORIGIN');}
 if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port||base.origin!==origin||!/^[a-f0-9]{64}$/.test(capability))throw new DesktopStartupError('INVALID_DESKTOP_ORIGIN');
 let response:Response;
 try{response=await request(`${origin}/api/auth/status`,{headers:{'X-Atelier-Desktop':capability},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw new DesktopStartupError('BACKEND_UNAVAILABLE');}
 let value:Record<string,unknown>;
 try{if(Number(response.headers.get('content-length')||0)>16384)throw new Error();const body=await response.text();if(body.length>16384)throw new Error();value=JSON.parse(body);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();}catch{throw new DesktopStartupError('INVALID_BACKEND_RESPONSE',response.status);}
 if(!response.ok){const code=typeof value.code==='string'&&Object.hasOwn(messages,value.code)?value.code:'BACKEND_UNAVAILABLE';throw new DesktopStartupError(code,response.status);}
 try{parseWorkspaceAuthStatus(value,true);}catch{throw new DesktopStartupError('INVALID_BACKEND_RESPONSE',response.status);}
}
