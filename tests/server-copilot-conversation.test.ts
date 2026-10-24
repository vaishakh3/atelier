import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {Server} from 'node:http';
import {createApp} from '../server/app';
import type {CopilotInput} from '../server/copilot';
import type {AiProposal,Project} from '../src/domain/types';
import {createBlankProject} from '../src/domain/seed';
import {createDesignProposal,initializeDesignWorkbench,switchDesignProposal} from '../src/domain/designWorkbench';
import {ApiError} from '../server/errors';

const servers=new Set<Server>(),directories=new Set<string>(),password='Encrypted conversation QA fixture 2026!';
afterEach(async()=>{for(const server of servers)await new Promise<void>(resolve=>server.close(()=>resolve()));servers.clear();for(const directory of directories)await rm(directory,{recursive:true,force:true});directories.clear();});
const response=(input:CopilotInput):AiProposal=>({id:`turn-${crypto.randomUUID()}`,prompt:input.prompt,summary:'Context-aware analysis fixture',issues:[],selectedIds:input.selectedIds,kind:'analysis',changes:[],model:'fixture',createdAt:new Date().toISOString()});
async function launch(propose=(async(input:CopilotInput)=>response(input)),existing?:string){
 const directory=existing??await mkdtemp(path.join(tmpdir(),'atelier-server-conversation-'));directories.add(directory);const server=createApp({dataDir:directory,requireIdentity:true,encryptionKey:Buffer.alloc(32,63),propose}).listen(0,'127.0.0.1');servers.add(server);await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Listener unavailable');
 const origin=`http://127.0.0.1:${address.port}`;
 const client=()=>{let cookie='';return async(route:string,method='GET',body?:unknown,etag?:string)=>{const result=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...(etag?{'If-Match':etag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const issued=result.headers.get('set-cookie');if(issued)cookie=issued.split(';')[0];return result;};};
 const owner=client();return{directory,server,client,owner};
}
async function setup(app:Awaited<ReturnType<typeof launch>>,project=createBlankProject('Private conversation')){const setup=await app.owner('/api/auth/setup','POST',{name:'Conversation owner',email:'owner@conversation.test',password});expect(setup.status).toBe(201);const user=(await setup.json()).user;const created=await app.owner('/api/projects','POST',project);expect(created.status).toBe(201);return{user,...await created.json()}as{user:{id:string};project:Project;etag:string};}

describe('authenticated project copilot threads',()=>{
 it.each([false,true])('finishes outcome metadata in the original thread after navigation (existing workbench: %s)',async(hasWorkbench)=>{
  const app=await launch(async input=>({...response(input),kind:'schedule',crewCount:3})),base=createBlankProject('Scoped outcome'),saved=await setup(app,hasWorkbench?initializeDesignWorkbench(base,'editor'):base),route=`/api/projects/${saved.project.id}/copilot/conversation`,originalBranch=saved.project.workbench?.activeProposalId??'';
  const proposed=await app.owner('/api/copilot','POST',{project:saved.project,prompt:'Compare three crews',selectedIds:[]});expect(proposed.status).toBe(200);const turn=(await proposed.json()).id;
  const next=hasWorkbench?createDesignProposal(saved.project,'Navigated alternative','editor'):initializeDesignWorkbench(saved.project,'editor');
  const switched=await app.owner(`/api/projects/${saved.project.id}`,'PUT',{...next,version:next.version+1},saved.etag);expect(switched.status).toBe(200);const current=await switched.json();
  expect((await app.owner(`${route}/turns/${turn}`,'PATCH',{status:'applied'})).status).toBe(404);
  const patched=await app.owner(`${route}/turns/${turn}?branchId=${encodeURIComponent(originalBranch)}`,'PATCH',{status:'applied'});expect(patched.status).toBe(200);expect((await patched.json()).conversation.turns[0].status).toBe('applied');
  expect((await(await app.owner(route)).json()).conversation.turns).toEqual([]);
  expect((await app.owner(`${route}/turns/${turn}?branchId=missing-proposal`,'PATCH',{status:'rejected'})).status).toBe(404);
  expect((await app.owner(`${route}/turns/${turn}?branchId=bad%2Fbranch`,'PATCH',{status:'rejected'})).status).toBe(400);
  const model=await app.owner(`/api/projects/${saved.project.id}`);expect(model.headers.get('etag')).toBe(current.etag);expect((await model.json()).project).toEqual(current.project);
 });
 it('records applied/rejected review outcomes without applying geometry or changing the model revision',async()=>{
  const propose=vi.fn(async(input:CopilotInput):Promise<AiProposal>=>({...response(input),kind:'schedule',crewCount:3})),app=await launch(propose),saved=await setup(app),route=`/api/projects/${saved.project.id}/copilot/conversation`;
  const first=await(await app.owner('/api/copilot','POST',{project:saved.project,prompt:'Compare three crews',selectedIds:[]})).json();
  expect((await(await app.owner(route)).json()).conversation.turns[0].status).toBe('proposed');
  expect((await app.owner(`${route}/turns/${first.id}`,'PATCH',{status:'applied'})).status).toBe(200);
  expect((await app.owner(`${route}/turns/${first.id}`,'PATCH',{status:'rejected'})).status).toBe(409);
  const model=await app.owner(`/api/projects/${saved.project.id}`);expect(model.headers.get('etag')).toBe(saved.etag);expect((await model.json()).project).toEqual(saved.project);
  expect((await app.owner('/api/copilot','POST',{project:saved.project,prompt:'Next planning question',selectedIds:[]})).status).toBe(200);expect(propose.mock.calls[1][0].pendingProposal).toBeUndefined();expect(propose.mock.calls[1][0].conversation?.[0].status).toBe('applied');
 });
 it('does not save unsuccessful provider results',async()=>{
  const app=await launch(async()=>{throw new ApiError(502,'AI_PROVIDER_FAILURE','The provider could not complete this request');}),saved=await setup(app),route=`/api/projects/${saved.project.id}/copilot/conversation`;
  expect((await app.owner('/api/copilot','POST',{project:saved.project,selectedIds:[],prompt:'A failed request'})).status).toBe(502);
  expect((await(await app.owner(route)).json()).conversation.turns).toEqual([]);
 });
 it('loads trusted context before generation and retains encrypted conversation after service restart without changing project version',async()=>{
  const propose=vi.fn(async(input:CopilotInput)=>response(input)),app=await launch(propose),saved=await setup(app),route=`/api/projects/${saved.project.id}/copilot/conversation`;
  const first=await app.owner('/api/copilot','POST',{project:saved.project,selectedIds:[],prompt:'Keep the library in this house'});expect(first.status).toBe(200);const original=await first.json();expect(original.conversationTurnId).toBe(original.id);
  expect((await app.owner('/api/copilot','POST',{project:saved.project,selectedIds:[],prompt:'What about its size?'})).status).toBe(200);expect(propose.mock.calls[1][0].conversation?.[0].prompt).toBe('Keep the library in this house');
  expect((await app.owner('/api/copilot','POST',{project:saved.project,selectedIds:[],prompt:'Forged context',conversation:[]})).status).toBe(400);
  const model=(await(await app.owner(`/api/projects/${saved.project.id}`)).json()).project;expect(model).toEqual(saved.project);
  await new Promise<void>(resolve=>app.server.close(()=>resolve()));servers.delete(app.server);const restarted=await launch(undefined,app.directory);expect((await restarted.owner('/api/auth/login','POST',{email:'owner@conversation.test',password})).status).toBe(200);
  expect((await(await restarted.owner(route)).json()).conversation.turns).toHaveLength(2);
  expect((await restarted.owner(route,'DELETE')).status).toBe(200);expect((await(await restarted.owner(route)).json()).conversation.turns).toEqual([]);
 });
 it('isolates user/branch threads and enforces membership and reviewer/contributor roles',async()=>{
  const app=await launch(),seed=initializeDesignWorkbench(createBlankProject('Branch memory'),'editor'),saved=await setup(app,seed),route=`/api/projects/${saved.project.id}/copilot/conversation`;
  const initial=await app.owner('/api/copilot','POST',{project:saved.project,selectedIds:[],prompt:'Remember the first option'});expect(initial.status).toBe(200);const turn=(await initial.json()).id;
  const created=await app.owner('/api/users','POST',{name:'Collaborator',email:'member@conversation.test',password,isAdmin:false}),member=(await created.json()).user,other=app.client();await other('/api/auth/login','POST',{email:'member@conversation.test',password});expect((await other(route)).status).toBe(404);
  const membership=(role:string)=>app.owner(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:saved.user.id,role:'admin'},{userId:member.id,role}]});await membership('reviewer');expect((await other(route)).status).toBe(200);expect((await(await other(route)).json()).conversation.turns).toEqual([]);
  expect((await other(route,'DELETE')).status).toBe(403);expect((await other(`${route}/turns/${turn}`,'PATCH',{status:'applied'})).status).toBe(403);expect((await other('/api/copilot','POST',{project:saved.project,prompt:'Review this plan',selectedIds:[]})).status).toBe(403);
  await membership('contributor');expect((await other('/api/copilot','POST',{project:saved.project,prompt:'Explain the programme',selectedIds:[]})).status).toBe(200);expect((await(await other(route)).json()).conversation.turns).toHaveLength(1);expect((await(await app.owner(route)).json()).conversation.turns).toHaveLength(1);
  let branch=createDesignProposal(saved.project,'Alternative','editor');const put=await app.owner(`/api/projects/${branch.id}`,'PUT',{...branch,version:branch.version+1},saved.etag);expect(put.status).toBe(200);const updated=await put.json();branch=updated.project;expect((await(await app.owner(route)).json()).conversation.turns).toEqual([]);expect((await app.owner(`${route}/turns/${turn}`,'PATCH',{status:'rejected'})).status).toBe(404);
  expect((await app.owner('/api/copilot','POST',{project:saved.project,prompt:'Unsaved old branch',selectedIds:[]})).status).toBe(409);
  const restored=switchDesignProposal(branch,saved.project.workbench!.activeProposalId,'editor');expect((await app.owner(`/api/projects/${branch.id}`,'PUT',{...restored,version:restored.version+1},updated.etag)).status).toBe(200);expect((await(await app.owner(route)).json()).conversation.turns[0].id).toBe(turn);
 });
 it('rejects a late response after reset instead of repopulating a cleared thread',async()=>{
  let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const app=await launch(async input=>{entered();await gate;return response(input);}),saved=await setup(app),route=`/api/projects/${saved.project.id}/copilot/conversation`;
  const pending=app.owner('/api/copilot','POST',{project:saved.project,selectedIds:[],prompt:'A request running during reset'});await started;expect((await app.owner(route,'DELETE')).status).toBe(200);release();const result=await pending;expect(result.status).toBe(409);expect((await result.json()).code).toBe('CONVERSATION_RESET');expect((await(await app.owner(route)).json()).conversation.turns).toEqual([]);
 });
});
