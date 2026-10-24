import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {Server} from 'node:http';
import {createApp} from '../server/app';
import {createDemoProject} from '../src/domain/seed';
import type {Project} from '../src/domain/types';
import {assignDesignLayer,createDesignLayer,createDesignProposal,initializeDesignWorkbench,updateDesignLayer} from '../src/domain/designWorkbench';
import {emptySiteContext} from '../src/site/types';
import {defaultViewState} from '../src/model/viewState';
import {saveDesignTemplate} from '../src/model/authoring';

const servers=new Set<Server>(),directories=new Set<string>(),password='Independent design-workbench test credential 2026!';
afterEach(async()=>{for(const server of servers)await new Promise<void>(resolve=>server.close(()=>resolve()));servers.clear();for(const directory of directories)await rm(directory,{recursive:true,force:true});directories.clear();});
async function launch(existing?:string){
 const directory=existing??await mkdtemp(path.join(tmpdir(),'atelier-workbench-'));directories.add(directory);
 const server=createApp({dataDir:directory,encryptionKey:Buffer.alloc(32,51),requireIdentity:true}).listen(0,'127.0.0.1');servers.add(server);
 await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No test listener');
 const origin=`http://127.0.0.1:${address.port}`;
 function client(){let cookie='';return{request:async(route:string,method='GET',body?:unknown,etag?:string)=>{const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...(etag?{'If-Match':etag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const issued=response.headers.get('set-cookie');if(issued)cookie=issued.split(';')[0];return response;}};}
 const owner=client();
 async function setup(){const response=await owner.request('/api/auth/setup','POST',{name:'Workbench owner',email:'workbench-owner@example.test',password});expect(response.status).toBe(201);return(await response.json()).user as{id:string};}
 return{server,directory,owner,client,setup};
}
type Client=Awaited<ReturnType<typeof launch>>['owner'];
async function create(owner:Client,project=fixture()){const response=await owner.request('/api/projects','POST',project);expect(response.status).toBe(201);return await response.json()as{project:Project;etag:string};}
async function put(client:Client,project:Project,etag:string){return client.request(`/api/projects/${project.id}`,'PUT',{...project,version:project.version+1},etag);}
function fixture(){
 let project=createDemoProject();project.site=emptySiteContext();project.site.source='Shared surveyed base fixture';project.site.latitude=10.2;project.site.longitude=76.2;
 project.site.contexts=[{id:'site-reference',name:'Survey reference fixture',format:'DXF',source:'Authored test linework',placement:{units:'m',scale:1,rotation:0,origin:{x:0,y:0,z:0}},vertices:[{x:0,y:0,z:0},{x:10,y:0,z:0}],faces:[],lines:[[0,1]],report:{accepted:1,excluded:0,warnings:[]}}];
 project.site.terrain={source:'Authored surveyed terrain',vertices:[{x:0,y:0,z:0},{x:10,y:0,z:1},{x:0,y:10,z:2}],faces:[[0,1,2]]};
 project.viewState=defaultViewState(project);project.viewState.savedViews=[{id:'saved-plan',name:'Courtyard view',viewMode:'plan',levelId:'level-0',hiddenIds:[],isolatedIds:[],plan:{x:-1,y:-1,width:15,height:12}}];
 project=saveDesignTemplate(project,'Library unit','unit',['room-study'],'level-0','editor');
 project=initializeDesignWorkbench(project,'editor');project=createDesignProposal(project,'Courtyard option','editor');
 project=createDesignLayer(project,'Survey base','context','editor');project=assignDesignLayer(project,project.workbench!.layers[0].id,['site-reference','site-terrain'],'editor');
 return project;
}

describe('protected persistence of design workbench, site, views and library',()=>{
 it('roundtrips every new field through encrypted storage and a full service restart',async()=>{
  const app=await launch();await app.setup();const saved=await create(app.owner);
  const changed=structuredClone(saved.project);changed.viewState!.savedViews[0].name='Retained courtyard view';changed.site!.contexts[0].placement.origin.x=3;
  const response=await put(app.owner,changed,saved.etag);expect(response.status).toBe(200);const updated=(await response.json()).project as Project;
  await new Promise<void>(resolve=>app.server.close(()=>resolve()));servers.delete(app.server);
  const restarted=await launch(app.directory);expect((await restarted.owner.request('/api/auth/login','POST',{email:'workbench-owner@example.test',password})).status).toBe(200);
  const read=await restarted.owner.request(`/api/projects/${saved.project.id}`);expect(read.status).toBe(200);const reopened=(await read.json()).project as Project;
  expect(reopened.workbench).toEqual(updated.workbench);expect(reopened.site).toEqual(updated.site);expect(reopened.viewState).toEqual(updated.viewState);expect(reopened.designLibrary).toEqual(updated.designLibrary);
  for(const filename of(await readdir(app.directory)).filter(filename=>filename.endsWith('.atelier'))){const raw=await readFile(path.join(app.directory,filename),'utf8');expect(raw).not.toContain('Survey reference fixture');expect(raw).not.toContain('Retained courtyard view');expect(raw).not.toContain('Courtyard option');}
 });

 it('enforces reviewer/contributor/editor scope for all four extension fields without role impersonation',async()=>{
  const app=await launch(),owner=await app.setup(),saved=await create(app.owner);
  const memberResponse=await app.owner.request('/api/users','POST',{name:'Discipline collaborator',email:'discipline@example.test',password,isAdmin:false});expect(memberResponse.status).toBe(201);const member=(await memberResponse.json()).user as{id:string},collaborator=app.client();
  expect((await collaborator.request('/api/auth/login','POST',{email:'discipline@example.test',password})).status).toBe(200);
  for(const role of ['reviewer','contributor']as const){
   expect((await app.owner.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:owner.id,role:'admin'},{userId:member.id,role}]})).status).toBe(200);
   const mutations=[(project:Project)=>{project.workbench!.proposals[0].name='Unauthorized branch';},(project:Project)=>{project.site!.trueNorthAngle=15;},(project:Project)=>{project.viewState!.savedViews[0].name='Unauthorized view';},(project:Project)=>{project.designLibrary!.templates[0].name='Unauthorized template';}];
   for(const mutate of mutations){const changed=structuredClone(saved.project);mutate(changed);expect((await put(collaborator,changed,saved.etag)).status).toBe(403);}
  }
  expect((await app.owner.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:owner.id,role:'admin'},{userId:member.id,role:'editor'}]})).status).toBe(200);
  const changed=structuredClone(saved.project);changed.workbench!.proposals[0].name='Editor branch';changed.site!.trueNorthAngle=5;changed.viewState!.savedViews[0].name='Editor saved view';changed.designLibrary!.templates[0].name='Editor library unit';
  const response=await put(collaborator,changed,saved.etag);expect(response.status).toBe(200);const updated=(await response.json()).project as Project;
  expect(updated.workbench!.proposals[0].name).toBe('Editor branch');expect(updated.viewState!.savedViews[0].name).toBe('Editor saved view');
 });

 it('blocks locked shared context and terrain mutations at the API while allowing an explicit unlock',async()=>{
  const app=await launch();await app.setup();let project=fixture();project=updateDesignLayer(project,project.workbench!.layers[0].id,{locked:true},'editor');const saved=await create(app.owner,project);
  const moved=structuredClone(saved.project);moved.site!.contexts[0].placement.origin.x+=1;
  const movedResponse=await put(app.owner,moved,saved.etag);expect(movedResponse.status).toBe(403);expect((await movedResponse.json()).code).toBe('LOCKED_CONTEXT');
  const terrain=structuredClone(saved.project);terrain.site!.terrain!.vertices[0].z+=1;
  const terrainResponse=await put(app.owner,terrain,saved.etag);expect(terrainResponse.status).toBe(403);expect((await terrainResponse.json()).code).toBe('LOCKED_CONTEXT');
  const unlocked=updateDesignLayer(saved.project,saved.project.workbench!.layers[0].id,{locked:false},'editor');const unlockedResponse=await put(app.owner,unlocked,saved.etag);expect(unlockedResponse.status).toBe(200);const current=await unlockedResponse.json();
  const changed=structuredClone(current.project)as Project;changed.site!.contexts[0].placement.origin.x=20;
  expect((await put(app.owner,changed,current.etag)).status).toBe(200);
 });

 it('rejects recursive snapshots and malformed external geometry/camera/library data before saving',async()=>{
  const app=await launch();await app.setup();const saved=await create(app.owner);
  const recursive=structuredClone(saved.project);recursive.workbench!.proposals[0].modelJson=JSON.stringify({...createDemoProject(),workbench:{schemaVersion:1}});
  expect((await put(app.owner,recursive,saved.etag)).status).toBe(400);
  const terrain=structuredClone(saved.project);terrain.site!.terrain!.faces=[[0,1,99]];expect((await put(app.owner,terrain,saved.etag)).status).toBe(400);
  const camera=structuredClone(saved.project);camera.viewState!.savedViews[0].plan!.width=0;expect((await put(app.owner,camera,saved.etag)).status).toBe(400);
  const library=structuredClone(saved.project);library.designLibrary!.templates[0].elements[0].width=-1;expect((await put(app.owner,library,saved.etag)).status).toBe(400);
  const read=await app.owner.request(`/api/projects/${saved.project.id}`);expect((await read.json()).project.workbench).toEqual(saved.project.workbench);
 });
});
