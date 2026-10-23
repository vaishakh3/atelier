import {afterEach,describe,expect,it,vi} from 'vitest';
import {apiFetch,setPilotRole,setIdentityMode} from '../src/domain/api';
afterEach(()=>{vi.unstubAllGlobals();setPilotRole('admin');setIdentityMode(false);});
describe('local session recovery boundary',()=>{
 it('renews an expired local session using the current review role and retries once',async()=>{setPilotRole('contributor');const calls:unknown[][]=[];const f=vi.fn(async(...args:unknown[])=>{calls.push(args);if(calls.length===1)return new Response(JSON.stringify({error:'Start a local session first'}),{status:401});if(calls.length===2)return new Response('{}',{status:200});return new Response('{"ok":true}',{status:200});});vi.stubGlobal('fetch',f);const r=await apiFetch('/api/projects/a',{method:'PUT',body:'{}'});expect(r.status).toBe(200);expect(calls[1][0]).toBe('/api/session');expect(JSON.parse((calls[1][1] as RequestInit).body as string).role).toBe('contributor');expect(calls[2][0]).toBe('/api/projects/a');});
 it('does not interpret provider authentication errors as a local session expiry',async()=>{const f=vi.fn(async()=>new Response(JSON.stringify({error:'OpenAI authentication failed. Check the server credential.'}),{status:401}));vi.stubGlobal('fetch',f);expect((await apiFetch('/api/copilot',{method:'POST'})).status).toBe(401);expect(f).toHaveBeenCalledTimes(1);});
 it('does not retry forbidden writes or silently expand a role',async()=>{const f=vi.fn(async()=>new Response('{}',{status:403}));vi.stubGlobal('fetch',f);expect((await apiFetch('/api/projects/a',{method:'PUT'})).status).toBe(403);expect(f).toHaveBeenCalledTimes(1);});
});

describe('production identity boundary',()=>{
 it('locks the workspace only for an explicit local authentication expiry',async()=>{setIdentityMode(true);const dispatchEvent=vi.fn();vi.stubGlobal('window',{dispatchEvent});const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'Provider authentication failed'}),{status:401})).mockResolvedValueOnce(new Response(JSON.stringify({code:'AUTH_REQUIRED',error:'Sign in again'}),{status:401}));vi.stubGlobal('fetch',f);await apiFetch('/api/copilot');expect(dispatchEvent).not.toHaveBeenCalled();await apiFetch('/api/projects');expect(dispatchEvent).toHaveBeenCalledOnce();expect(f).toHaveBeenCalledTimes(2);});
});
