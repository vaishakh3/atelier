import {describe,it,expect,vi} from 'vitest';
import {assertDesktopBackendReady} from '../desktop/backend-readiness';
describe('desktop readiness before opening the workspace',()=>{
 const origin='http://127.0.0.1:43123',capability='a'.repeat(64);
 const respond=(body:unknown,status=200)=>vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(body),{status}));
 it('checks the protected identity route, not only the listening socket',async()=>{
  const request=respond({identityRequired:true,setupRequired:true,authenticated:false,user:null});
  await expect(assertDesktopBackendReady(origin,capability,request)).resolves.toBeUndefined();
  expect(request).toHaveBeenCalledWith(`${origin}/api/auth/status`,expect.objectContaining({headers:{'X-Atelier-Desktop':capability},redirect:'error'}));
 });
 it('preserves actionable integrity and migration codes without exposing backend text',async()=>{
  for(const code of ['STORAGE_INTEGRITY','MIGRATION_FAILED','ACCESS_INTEGRITY','DESKTOP_CAPABILITY_REQUIRED']){
   await expect(assertDesktopBackendReady(origin,capability,respond({code,error:'private raw data'},503))).rejects.toMatchObject({code,status:503});
   await expect(assertDesktopBackendReady(origin,capability,respond({code,error:'private raw data'},503))).rejects.not.toThrow('private raw data');
  }
 });
 it('rejects malformed and development-mode status rather than declaring desktop readiness',async()=>{
  for(const value of [{},{identityRequired:false,setupRequired:false,authenticated:true},null,[],{identityRequired:true,setupRequired:'false',authenticated:false},{identityRequired:true,setupRequired:false,authenticated:true,user:null}])await expect(assertDesktopBackendReady(origin,capability,respond(value))).rejects.toMatchObject({code:'INVALID_BACKEND_RESPONSE'});
 });
 it('keeps capabilities on the exact loopback origin and fails safely on network errors',async()=>{
  const request=respond({});
  for(const value of ['https://example.com','http://127.0.0.1:43123/path','http://localhost:43123'])await expect(assertDesktopBackendReady(value,capability,request)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  await expect(assertDesktopBackendReady(origin,capability,vi.fn(async()=>{throw new Error('private network details');}))).rejects.toMatchObject({code:'BACKEND_UNAVAILABLE'});
 });
});
