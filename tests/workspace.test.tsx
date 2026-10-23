// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {useWorkspace} from '../src/domain/useWorkspace';
import {createDemoProject} from '../src/domain/seed';
import {setIdentityMode} from '../src/domain/api';
import type {Project} from '../src/domain/types';
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
function fixture(initial=createDemoProject(),extras:Project[]=[]){
 let disk=structuredClone(initial),tag='revision-1';const calls:{url:string;method:string;body?:Project}[]=[];let hold:Promise<void>|null=null,listHold:Promise<void>|null=null,publicationHold:Promise<void>|null=null,commentHold:Promise<void>|null=null,deleted=false;const readHolds=new Map<string,Promise<void>>();
 const fetch=vi.fn(async(input:string,init?:RequestInit)=>{const method=init?.method||'GET';calls.push({url:input,method,body:init?.body?JSON.parse(String(init.body)):undefined});
 if(input==='/api/usage')return json({ok:true},202);
 if(input==='/api/health')return json({aiReady:false});
 if(input==='/api/projects'&&method==='GET'){await listHold;return json({projects:[disk,...extras],permissions:Object.fromEntries([disk,...extras].map(p=>[p.id,'admin'])),etags:Object.fromEntries([disk,...extras].map(p=>[p.id,p.id===disk.id?tag:'extra-'+p.id]))});}
 if(input.startsWith('/api/recovery/'))return method==='GET'?json({recovery:null}):json({ok:true});
 if(input.endsWith('/versions')){if(method==='POST'){await publicationHold;return json({version:{id:'snapshot-'+disk.id,label:'Published snapshot',actor:'Author',timestamp:new Date().toISOString(),project:structuredClone(disk)}});}return json({versions:[]});}
 if(input.endsWith('/comments')){if(method==='POST'){await commentHold;return json({comment:{id:'comment-delayed',versionId:'snapshot-first',author:'Author',text:'A comment on the first project',createdAt:new Date().toISOString()}});}return json({comments:[]});}
 if(method==='GET'&&input.startsWith('/api/projects/')){const id=input.slice('/api/projects/'.length),project=id===disk.id?disk:extras.find(p=>p.id===id);if(project){await readHolds.get(id);return json({project,role:'admin',etag:id===disk.id?tag:'extra-'+id});}}
 if(input==='/api/projects/'+disk.id&&method==='PUT'){if(deleted)return json({error:'Project not found',code:'NOT_FOUND'},404);const submitted=JSON.parse(String(init?.body)) as Project;await hold;if(submitted.version<=disk.version)return json({error:'Revision conflict'},409);disk={...submitted,audit:submitted.audit.map(entry=>({...entry,actor:'authenticated-user'}))};tag='revision-'+disk.version;return json({project:disk,role:'admin',etag:tag});}
 throw new Error('Unexpected request '+method+' '+input);
 });vi.stubGlobal('fetch',fetch);return{calls,get disk(){return disk;},update:(next:Project)=>{disk=next;tag='external-revision';},hold:(promise:Promise<void>|null)=>{hold=promise;},holdRead:(id:string,promise:Promise<void>)=>readHolds.set(id,promise),holdList:(promise:Promise<void>)=>{listHold=promise;},holdPublication:(promise:Promise<void>)=>{publicationHold=promise;},holdComment:(promise:Promise<void>)=>{commentHold=promise;},deleteOnServer:()=>{deleted=true;}};
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();setIdentityMode(false);});
describe('desktop workspace persistence',()=>{
 it('coalesces overlapping flushes even when the server canonicalizes the audit',async()=>{setIdentityMode(true);const f=fixture();const hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));act(()=>hook.result.current.commit({...hook.result.current.project,name:'Reviewed house'},'Rename'));
 let release!:()=>void;f.hold(new Promise<void>(resolve=>{release=resolve;}));let a!:Promise<void>,b!:Promise<void>;act(()=>{a=hook.result.current.flush();b=hook.result.current.flush();});await waitFor(()=>expect(f.calls.filter(call=>call.method==='PUT'&&call.url.startsWith('/api/projects/'))).toHaveLength(1));release();await act(async()=>{await Promise.all([a,b]);});expect(f.disk.name).toBe('Reviewed house');expect(f.calls.filter(call=>call.method==='PUT'&&call.url.startsWith('/api/projects/'))).toHaveLength(1);expect(hook.result.current.project.audit[0].actor).toBe('authenticated-user');
 });
 it('retains a newer edit made during a save and persists it with the new revision token',async()=>{setIdentityMode(true);const f=fixture();const hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));act(()=>hook.result.current.commit({...hook.result.current.project,name:'First edit'},'Rename'));let release!:()=>void;f.hold(new Promise<void>(resolve=>{release=resolve;}));let save!:Promise<void>;act(()=>{save=hook.result.current.flush();});await waitFor(()=>expect(f.calls.some(call=>call.method==='PUT')).toBe(true));act(()=>hook.result.current.commit({...hook.result.current.project,name:'Newer edit'},'Rename again'));release();await act(async()=>{await save;});expect(hook.result.current.project.name).toBe('Newer edit');f.hold(null);await act(async()=>{await hook.result.current.flush();});expect(f.disk.name).toBe('Newer edit');expect(f.disk.version).toBe(hook.result.current.project.version);
 });
 it('keeps unsaved state locked after expiry and refuses to flush or undo',async()=>{setIdentityMode(true);fixture();const hook=renderHook(({authenticated})=>useWorkspace({identityRequired:true,userId:'author',authenticated}),{initialProps:{authenticated:true}});await waitFor(()=>expect(hook.result.current.ready).toBe(true));act(()=>hook.result.current.commit({...hook.result.current.project,name:'Pending local change'},'Rename'));hook.rerender({authenticated:false});act(()=>{hook.result.current.undoAction();hook.result.current.commit({...hook.result.current.project,name:'Unauthorized'},'Rename');});expect(hook.result.current.project.name).toBe('Pending local change');await expect(hook.result.current.flush()).rejects.toThrow('Sign in');
 });
 it('fetches the current model on project switch instead of opening a stale cached copy',async()=>{setIdentityMode(true);const f=fixture();const hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));const cached=structuredClone(hook.result.current.project);f.update({...cached,name:'Changed in another session',version:cached.version+1});await act(async()=>{await hook.result.current.switchProject(cached);});expect(hook.result.current.project.name).toBe('Changed in another session');
 });
 it('rejects queued saves after the account workspace unmounts',async()=>{setIdentityMode(true);const f=fixture();const hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));act(()=>hook.result.current.commit({...hook.result.current.project,name:'Pending edit'},'Rename'));let release!:()=>void;f.hold(new Promise<void>(resolve=>{release=resolve;}));let first!:Promise<void>,queued!:Promise<void>;act(()=>{first=hook.result.current.flush();queued=hook.result.current.flush();});const rejected=expect(queued).rejects.toThrow('workspace is closed');await waitFor(()=>expect(f.calls.some(call=>call.method==='PUT')).toBe(true));hook.unmount();release();await first;await rejected;expect(f.calls.filter(call=>call.method==='PUT'&&call.url.startsWith('/api/projects/'))).toHaveLength(1);
 });
 it('locks editing and undo synchronously while switching and rejects overlapping project switches',async()=>{
  setIdentityMode(true);const first=createDemoProject(),second={...structuredClone(first),id:'project-second',name:'Second project',updatedAt:'2026-01-01T00:00:00Z'},third={...structuredClone(second),id:'project-third',name:'Third project'},f=fixture(first,[second,third]);
  const hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
  act(()=>hook.result.current.commit({...hook.result.current.project,name:'Saved first project edit'},'Rename'));await act(async()=>{await hook.result.current.flush();});const before=structuredClone(hook.result.current.project);
  let release!:()=>void;f.holdRead(second.id,new Promise<void>(resolve=>release=resolve));let switching!:Promise<boolean>;
  act(()=>{switching=hook.result.current.switchProject(second);hook.result.current.commit({...hook.result.current.project,name:'Would be silently discarded'},'Edit during switch');hook.result.current.undoAction();});
  expect(hook.result.current.project).toEqual(before);await waitFor(()=>expect(f.calls.some(call=>call.url==='/api/projects/'+second.id&&call.method==='GET')).toBe(true));
  await act(async()=>{expect(await hook.result.current.switchProject(third)).toBe(false);});expect(hook.result.current.project).toEqual(before);
  release();await act(async()=>{expect(await switching).toBe(true);});expect(hook.result.current.project.id).toBe(second.id);expect(f.disk).toEqual(before);
 });
 it('refuses a default refresh that would discard unsaved local edits',async()=>{
  setIdentityMode(true);fixture();const hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
  act(()=>hook.result.current.commit({...hook.result.current.project,name:'Unsaved draft must survive'},'Rename'));const draft=structuredClone(hook.result.current.project);
  await act(async()=>{await expect(hook.result.current.refresh()).rejects.toThrow();});expect(hook.result.current.project).toEqual(draft);
 });
 it('locks commits and history while an authorized refresh is in flight',async()=>{
  setIdentityMode(true);const f=fixture(),hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
  act(()=>hook.result.current.commit({...hook.result.current.project,name:'Saved before refresh'},'Rename'));await act(async()=>{await hook.result.current.flush();});const before=structuredClone(hook.result.current.project);
  let release!:()=>void;f.holdList(new Promise<void>(resolve=>release=resolve));let refresh!:Promise<void>;
  act(()=>{refresh=hook.result.current.refresh();hook.result.current.commit({...hook.result.current.project,name:'Would be lost during refresh'},'Concurrent rename');hook.result.current.undoAction();});
  expect(hook.result.current.project).toEqual(before);release();await act(async()=>{await refresh;});expect(hook.result.current.project).toEqual(before);
 });
 it('keeps a deleted persisted project as an exportable draft and never recreates it through POST',async()=>{
  setIdentityMode(true);const f=fixture(),hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
  f.deleteOnServer();act(()=>hook.result.current.commit({...hook.result.current.project,name:'Changes after another session deleted the project'},'Rename'));const draft=structuredClone(hook.result.current.project);
  await act(async()=>{await expect(hook.result.current.flush()).rejects.toThrow();});expect(hook.result.current.project).toEqual(draft);expect(f.calls.filter(call=>call.url==='/api/projects'&&call.method==='POST')).toHaveLength(0);
 });
 it('blocks project switches during publication and scopes the published snapshot to its source project',async()=>{
  setIdentityMode(true);const first=createDemoProject(),second={...structuredClone(first),id:'project-second',updatedAt:'2026-01-01T00:00:00Z'},f=fixture(first,[second]),hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
  let release!:()=>void;f.holdPublication(new Promise<void>(resolve=>release=resolve));let publish!:ReturnType<typeof hook.result.current.publish>;
  act(()=>{publish=hook.result.current.publish('Review first project');});await waitFor(()=>expect(f.calls.some(call=>call.url==='/api/projects/'+first.id+'/versions'&&call.method==='POST')).toBe(true));
  await act(async()=>{expect(await hook.result.current.switchProject(second)).toBe(false);});expect(hook.result.current.project.id).toBe(first.id);
  release();await act(async()=>{await publish;});expect(hook.result.current.versions).toHaveLength(1);expect(hook.result.current.versions[0].project.id).toBe(first.id);
  await act(async()=>{await hook.result.current.switchProject(second);});await waitFor(()=>expect(hook.result.current.versions).toEqual([]));
 });
 it('ignores a comment response from a previously open project',async()=>{
  setIdentityMode(true);const first=createDemoProject(),second={...structuredClone(first),id:'project-second',updatedAt:'2026-01-01T00:00:00Z'},f=fixture(first,[second]),hook=renderHook(()=>useWorkspace({identityRequired:true,userId:'author',authenticated:true}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
  let release!:()=>void;f.holdComment(new Promise<void>(resolve=>release=resolve));let comment!:Promise<void>;act(()=>{comment=hook.result.current.addComment('snapshot-first','A comment on the first project');});
  await waitFor(()=>expect(f.calls.some(call=>call.url==='/api/projects/'+first.id+'/comments'&&call.method==='POST')).toBe(true));await act(async()=>{await hook.result.current.switchProject(second);});expect(hook.result.current.project.id).toBe(second.id);
  release();await act(async()=>{await comment;});expect(hook.result.current.comments).toEqual([]);
 });

});
