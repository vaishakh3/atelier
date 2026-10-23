// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AuthProvider,useAuth} from '../src/domain/auth';
import {apiFetch,parseWorkspaceAuthStatus,requestWorkspaceAuthStatus,setIdentityMode,WorkspaceStartupError} from '../src/domain/api';
import type {ReactNode} from 'react';

const user={id:'user-qa',name:'QA fixture',email:'qa@example.test',isAdmin:true,createdAt:'2026-10-24T12:00:00Z'};
const signedOut={identityRequired:true,setupRequired:false,authenticated:false,user:null};
const signedIn={...signedOut,authenticated:true,user};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const wrapper=({children}:{children:ReactNode})=><AuthProvider>{children}</AuthProvider>;
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
afterEach(()=>{cleanup();vi.unstubAllGlobals();setIdentityMode(false);delete window.atelierDesktop;});

describe('fail-closed local identity startup',()=>{
 it('rejects incomplete and contradictory status payloads instead of entering development mode',()=>{
  for(const value of [{},{error:'broken'},{...signedOut,identityRequired:undefined},{...signedOut,authenticated:'false'},{...signedOut,user:undefined},{...signedOut,authenticated:true},{...signedIn,setupRequired:true},{...signedOut,user},{...signedOut,user:[],authenticated:true}])expect(()=>parseWorkspaceAuthStatus(value)).toThrow(WorkspaceStartupError);
  expect(parseWorkspaceAuthStatus({identityRequired:false,setupRequired:false,authenticated:false,user:null})).toEqual({identityRequired:false,setupRequired:false,authenticated:false,user:null});
  expect(()=>parseWorkspaceAuthStatus({identityRequired:false,setupRequired:false,authenticated:false,user:null},true)).toThrow(/IDENTITY_REQUIRED/);
 });
 it('copies only the documented public identity fields and rejects malformed users',()=>{
  const parsed=parseWorkspaceAuthStatus({...signedIn,user:{...user,apiKey:'must-not-be-exposed',passwordHash:'must-not-be-exposed'}});expect(parsed.user).toEqual(user);expect(parsed.user).not.toBe(user);
  for(const patch of [{id:''},{name:''},{isAdmin:'true'},{createdAt:'bad'},{email:null}])expect(()=>parseWorkspaceAuthStatus({...signedIn,user:{...user,...patch}})).toThrow(/INVALID_AUTH_STATUS/);
 });
 it('reports capability and integrity errors safely without renewing a role or retrying them',async()=>{
  for(const code of ['DESKTOP_CAPABILITY_REQUIRED','STORAGE_INTEGRITY','ACCESS_INTEGRITY','MIGRATION_FAILED']){
   const status=code==='DESKTOP_CAPABILITY_REQUIRED'?403:503,fetch=vi.fn(async(_input:string,_init?:RequestInit)=>json({code,error:'sensitive backend detail sk-not-a-real-secret-value'},status));vi.stubGlobal('fetch',fetch);
   const error=await requestWorkspaceAuthStatus().catch(error=>error);
   expect(error).toBeInstanceOf(WorkspaceStartupError);expect(error.code).toBe(code);expect(error.status).toBe(status);expect(error.message).toContain('HTTP '+status);expect(error.message).not.toContain('sensitive backend detail');expect(error.message).not.toContain('sk-not-a-real-secret-value');expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/api/auth/status');
  }
 });
 it('distinguishes connection, malformed response and unknown engine errors without reflecting arbitrary text',async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(new TypeError('private connection detail')).mockResolvedValueOnce(new Response('<html>fallback</html>')).mockResolvedValueOnce(json({code:'untrusted-token-fragment',error:'private error'},500));vi.stubGlobal('fetch',fetch);
  await expect(requestWorkspaceAuthStatus()).rejects.toThrow(/CONNECTION_FAILED/);await expect(requestWorkspaceAuthStatus()).rejects.toThrow(/INVALID_AUTH_STATUS/);
  const error=await requestWorkspaceAuthStatus().catch(error=>error);expect(error.code).toBe('ENGINE_ERROR');expect(error.message).not.toContain('untrusted-token-fragment');expect(error.message).not.toContain('private error');
  expect(fetch).toHaveBeenCalledWith('/api/auth/status',expect.objectContaining({credentials:'same-origin',cache:'no-store',redirect:'error'}));
 });
 it('shows retry loading, recovers a valid status and keeps production requests in identity mode',async()=>{
  const pending=deferred<Response>(),fetch=vi.fn().mockResolvedValueOnce(json({code:'MIGRATION_FAILED'},503)).mockImplementationOnce(()=>pending.promise).mockResolvedValueOnce(json({code:'AUTH_REQUIRED'},401));vi.stubGlobal('fetch',fetch);
  const hook=renderHook(()=>useAuth(),{wrapper});await waitFor(()=>expect(hook.result.current.error).toMatch(/MIGRATION_FAILED/));expect(hook.result.current.authenticated).toBe(false);expect(hook.result.current.identityRequired).toBe(true);
  let retry!:Promise<void>;act(()=>{retry=hook.result.current.refresh();});expect(hook.result.current.loading).toBe(true);expect(hook.result.current.error).toBe('');
  await act(async()=>{pending.resolve(json(signedOut));await retry;});expect(hook.result.current.loading).toBe(false);expect(hook.result.current.error).toBe('');expect(hook.result.current.authenticated).toBe(false);
  await act(async()=>{await apiFetch('/api/projects');});expect(fetch).toHaveBeenCalledTimes(3);expect(fetch.mock.calls.some(call=>call[0]==='/api/session')).toBe(false);
 });
 it('ignores a failed superseded startup request under Strict Mode',async()=>{
  const first=deferred<Response>(),fetch=vi.fn().mockImplementationOnce(()=>first.promise).mockResolvedValueOnce(json(signedIn));vi.stubGlobal('fetch',fetch);
  const hook=renderHook(()=>useAuth(),{wrapper,reactStrictMode:true});
  await waitFor(()=>expect(hook.result.current.authenticated).toBe(true));await act(async()=>{first.resolve(json({code:'STORAGE_INTEGRITY'},503));await first.promise;});
  expect(hook.result.current.authenticated).toBe(true);expect(hook.result.current.user).toEqual(user);expect(hook.result.current.error).toBe('');expect((fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
 });
 it('does not let a pre-login status response overwrite a successful login',async()=>{
  const delayed=deferred<Response>(),fetch=vi.fn().mockResolvedValueOnce(json(signedOut)).mockImplementationOnce(()=>delayed.promise).mockResolvedValueOnce(json({user}));vi.stubGlobal('fetch',fetch);
  const hook=renderHook(()=>useAuth(),{wrapper});await waitFor(()=>expect(hook.result.current.loading).toBe(false));let refresh!:Promise<void>;act(()=>{refresh=hook.result.current.refresh();});
  await act(async()=>{await hook.result.current.authenticate({email:user.email,password:'isolated test fixture input'});});expect(hook.result.current.authenticated).toBe(true);
  await act(async()=>{delayed.resolve(json(signedOut));await refresh;});expect(hook.result.current.authenticated).toBe(true);expect(hook.result.current.user).toEqual(user);
 });
 it('preserves the locked user draft identity when refresh fails after sign-in',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(json(signedIn)).mockResolvedValueOnce(json({code:'ACCESS_INTEGRITY'},503));vi.stubGlobal('fetch',fetch);const hook=renderHook(()=>useAuth(),{wrapper});await waitFor(()=>expect(hook.result.current.authenticated).toBe(true));
  await act(async()=>{await hook.result.current.refresh();});expect(hook.result.current.authenticated).toBe(false);expect(hook.result.current.user).toBeNull();expect(hook.result.current.sessionUser).toEqual(user);expect(hook.result.current.error).toMatch(/ACCESS_INTEGRITY/);
 });
 it('requires protected identity mode in the desktop renderer',async()=>{
  window.atelierDesktop={} as NonNullable<Window['atelierDesktop']>;const fetch=vi.fn(async()=>json({identityRequired:false,setupRequired:false,authenticated:false,user:null}));vi.stubGlobal('fetch',fetch);
  const hook=renderHook(()=>useAuth(),{wrapper});await waitFor(()=>expect(hook.result.current.loading).toBe(false));expect(hook.result.current.identityRequired).toBe(true);expect(hook.result.current.authenticated).toBe(false);expect(hook.result.current.error).toMatch(/IDENTITY_REQUIRED/);
 });
 it('aborts startup on unmount and never accepts malformed successful login responses',async()=>{
  const pending=deferred<Response>(),fetch=vi.fn().mockImplementationOnce(()=>pending.promise);vi.stubGlobal('fetch',fetch);const hook=renderHook(()=>useAuth(),{wrapper});hook.unmount();expect((fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);await act(async()=>{pending.resolve(json(signedIn));await pending.promise;});
  fetch.mockResolvedValueOnce(json(signedOut)).mockResolvedValueOnce(json({user:null}));const second=renderHook(()=>useAuth(),{wrapper});await waitFor(()=>expect(second.result.current.loading).toBe(false));await act(async()=>{await expect(second.result.current.authenticate({email:user.email,password:'isolated test fixture input'})).rejects.toThrow(/INVALID_AUTH_STATUS/);});expect(second.result.current.authenticated).toBe(false);
 });
});
