import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {Server} from 'node:http';
import {createApp} from '../server/app';
import {createDemoProject} from '../src/domain/seed';
import type {Project} from '../src/domain/types';
import {RecordStore} from '../server/storage';

const password='An architecture password 2026';
const resources:{server:Server;directory:string}[]=[];
const temporary:string[]=[];
afterEach(async()=>{for(const {server,directory}of resources.splice(0)){await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}for(const dir of temporary.splice(0))await rm(dir,{recursive:true,force:true});});
async function launch(existingDirectory?:string){
 const directory=existingDirectory??await mkdtemp(path.join(tmpdir(),'atelier-identity-'));let proposals=0;
 const app=createApp({dataDir:directory,encryptionKey:Buffer.alloc(32,12),requireIdentity:true,propose:async input=>{proposals++;return{id:'ai-test',prompt:input.prompt,summary:'Analysis',kind:'analysis',changes:[],issues:[],selectedIds:input.selectedIds,model:'fixture',createdAt:new Date().toISOString()};}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));resources.push({server,directory});const address=server.address();if(!address||typeof address==='string')throw new Error('Listener failed');const origin=`http://127.0.0.1:${address.port}`;
 const client=()=>{let cookie='';return{request:async(route:string,method='GET',body?:unknown,headers:Record<string,string>={})=>{const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=response.headers.get('set-cookie');if(value)cookie=value.split(';')[0];return response;}};};
 const owner=client();const setup=async()=>{const response=await owner.request('/api/auth/setup','POST',{name:'Architect Owner',email:'owner@example.test',password});expect(response.status).toBe(201);return(await response.json()).user;};
 return{directory,origin,owner,client,setup,proposalCount:()=>proposals};
}
type Client=Awaited<ReturnType<typeof launch>>['owner'];
async function createProject(owner:Client){const response=await owner.request('/api/projects','POST',createDemoProject());expect(response.status).toBe(201);return await response.json()as{project:Project;etag:string;role:string};}
async function createMember(owner:Client,email='planner@example.test',isAdmin=false){const response=await owner.request('/api/users','POST',{name:'Planner',email,password,isAdmin});expect(response.status).toBe(201);return(await response.json()).user;}
async function login(client:Client,email='planner@example.test',credential=password){return client.request('/api/auth/login','POST',{email,password:credential});}

describe('real local identity and project authorization',()=>{
 it('allows an explicit startup retry after a migration input is repaired without weakening account checks',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'atelier-retry-')),project=createDemoProject(),file=path.join(directory,`${project.id}.json`);
  await writeFile(file,'malformed');const app=await launch(directory);
  const failed=await app.owner.request('/api/auth/status');expect(failed.status).toBe(503);expect((await failed.json()).code).toBe('MIGRATION_FAILED');
  await writeFile(file,JSON.stringify({project,versions:[],comments:[]}));
  const retried=await app.owner.request('/api/auth/status');expect(retried.status).toBe(200);expect(await retried.json()).toMatchObject({identityRequired:true,setupRequired:true,authenticated:false});
  expect((await app.owner.request('/api/projects')).status).toBe(401);
 });
 it('requires owner setup, removes role impersonation and persists only encrypted account material',async()=>{
  const app=await launch(),before=await(await app.owner.request('/api/auth/status')).json();expect(before).toMatchObject({identityRequired:true,setupRequired:true,authenticated:false,user:null});expect((await app.owner.request('/api/projects')).status).toBe(401);expect((await app.owner.request('/api/session','POST',{role:'admin'})).status).toBe(409);
  const owner=await app.setup();expect(owner.isAdmin).toBe(true);expect(owner).not.toHaveProperty('passwordHash');const status=await(await app.owner.request('/api/auth/status')).json();expect(status.authenticated).toBe(true);expect(status.setupRequired).toBe(false);expect((await app.owner.request('/api/auth/setup','POST',{name:'Other',email:'other@example.test',password})).status).toBe(409);
  for(const filename of(await readdir(app.directory)).filter(name=>name.endsWith('.atelier'))){const raw=await readFile(path.join(app.directory,filename),'utf8');expect(raw).not.toContain('owner@example.test');expect(raw).not.toContain(password);expect(raw).not.toContain('passwordHash');expect(JSON.parse(raw).format).toBe('atelier.aes-gcm.v1');}
  await app.owner.request('/api/auth/logout','POST',{});expect((await app.owner.request('/api/projects')).status).toBe(401);expect((await login(app.owner,'OWNER@example.test')).status).toBe(200);
 });
 it('blocks cross-project IDs across model, versions, comments, members, backups, recovery and AI',async()=>{
  const app=await launch();await app.setup();const {project}=await createProject(app.owner);await createMember(app.owner);const stranger=app.client();expect((await login(stranger)).status).toBe(200);const listing=await(await stranger.request('/api/projects')).json();expect(listing.projects).toEqual([]);
  for(const route of [`/api/projects/${project.id}`,`/api/projects/${project.id}/versions`,`/api/projects/${project.id}/comments`,`/api/projects/${project.id}/members`,`/api/projects/${project.id}/member-candidates`,`/api/recovery/${project.id}`])expect((await stranger.request(route)).status).toBe(404);
  expect((await stranger.request(`/api/projects/${project.id}`,'PUT',{...project,version:project.version+1},{'If-Match':'anything'})).status).toBe(404);
  expect((await stranger.request(`/api/projects/${project.id}/backup/export`,'POST',{password})).status).toBe(404);
  expect((await stranger.request('/api/copilot','POST',{prompt:'Explain this project',project,selectedIds:[]})).status).toBe(404);expect(app.proposalCount()).toBe(0);expect((await stranger.request('/api/users')).status).toBe(403);
 });
 it('uses actual per-project roles, denies global-admin implicit access and binds comment authors',async()=>{
  const app=await launch(),owner=await app.setup(),{project}=await createProject(app.owner),member=await createMember(app.owner),admin=await createMember(app.owner,'admin@example.test',true);
  const globalAdmin=app.client();await login(globalAdmin,'admin@example.test');expect((await globalAdmin.request(`/api/projects/${project.id}`)).status).toBe(404);expect((await globalAdmin.request('/api/users')).status).toBe(200);
  expect((await app.owner.request(`/api/projects/${project.id}/members`,'PUT',{members:[{userId:owner.id,role:'admin'},{userId:member.id,role:'reviewer'}]})).status).toBe(200);
  const reviewer=app.client();await login(reviewer);const snapshot=await(await app.owner.request(`/api/projects/${project.id}/versions`,'POST',{label:'Review'})).json();const comment=await(await reviewer.request(`/api/projects/${project.id}/comments`,'POST',{versionId:snapshot.version.id,text:'Review the entrance.'})).json();expect(comment.comment).toMatchObject({author:'Planner',authorId:member.id,role:'reviewer'});
  expect((await reviewer.request(`/api/projects/${project.id}/members`,'PUT',{members:[{userId:member.id,role:'admin'}]})).status).toBe(403);expect((await reviewer.request(`/api/projects/${project.id}/versions`,'POST',{label:'Fake'})).status).toBe(403);expect((await reviewer.request('/api/copilot','POST',{prompt:'Explain design',project,selectedIds:[]})).status).toBe(403);expect((await reviewer.request('/api/session','POST',{role:'admin'})).status).toBe(409);expect(admin.isAdmin).toBe(true);
 });
 it('checks If-Match atomically, allows exactly one concurrent writer and preserves authoritative audit',async()=>{
  const app=await launch();await app.setup();const saved=await createProject(app.owner),project=saved.project;
  expect((await app.owner.request(`/api/projects/${project.id}`,'PUT',{...project,version:project.version+1,name:'No revision token'})).status).toBe(428);
  const a={...structuredClone(project),name:'Revision A',version:project.version+1},b={...structuredClone(project),name:'Revision B',version:project.version+1};a.audit=[{id:'forged-new',actor:'Impersonated administrator',timestamp:'2000-01-01',action:'Changed name',affectedIds:[]},...a.audit];
  const responses=await Promise.all([app.owner.request(`/api/projects/${project.id}`,'PUT',a,{'If-Match':saved.etag}),app.owner.request(`/api/projects/${project.id}`,'PUT',b,{'If-Match':saved.etag})]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);const current=await(await app.owner.request(`/api/projects/${project.id}`)).json();expect(['Revision A','Revision B']).toContain(current.project.name);expect(current.project.audit[0].actor).toBe('Architect Owner');expect(JSON.stringify(current.project.audit)).not.toContain('Impersonated administrator');expect(current.etag).not.toBe(saved.etag);
 });
 it('keeps encrypted recovery isolated per user and enforces contributor scope',async()=>{
  const app=await launch(),owner=await app.setup(),saved=await createProject(app.owner),member=await createMember(app.owner);await app.owner.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:owner.id,role:'admin'},{userId:member.id,role:'contributor'}]});const planner=app.client();await login(planner);
  const recovery={...structuredClone(saved.project),name:'Private owner recovery',version:saved.project.version+1};expect((await app.owner.request(`/api/recovery/${saved.project.id}`,'PUT',{project:recovery,baseEtag:saved.etag})).status).toBe(200);expect((await(await planner.request(`/api/recovery/${saved.project.id}`)).json()).recovery).toBeNull();const changed=structuredClone(saved.project);changed.elements[0].width+=1;expect((await planner.request(`/api/recovery/${saved.project.id}`,'PUT',{project:changed,baseEtag:saved.etag})).status).toBe(403);
  const own=await(await app.owner.request(`/api/recovery/${saved.project.id}`)).json();expect(own.recovery.project.name).toBe('Private owner recovery');for(const filename of(await readdir(app.directory)).filter(f=>f.endsWith('.atelier')))expect(await readFile(path.join(app.directory,filename),'utf8')).not.toContain('Private owner recovery');
 });
 it('preserves original recovery base tokens and a newer draft while an older revision saves',async()=>{const app=await launch();await app.setup();const saved=await createProject(app.owner),draft={...structuredClone(saved.project),version:saved.project.version+2,name:'Newer unsaved recovery'},older={...structuredClone(saved.project),version:saved.project.version+1,name:'Older in-flight save'};const results=await Promise.all([app.owner.request(`/api/recovery/${saved.project.id}`,'PUT',{project:draft,baseEtag:saved.etag}),app.owner.request(`/api/projects/${saved.project.id}`,'PUT',older,{'If-Match':saved.etag})]);expect(results.map(r=>r.status)).toEqual([200,200]);const recovered=await(await app.owner.request(`/api/recovery/${saved.project.id}`)).json();expect(recovered.recovery.project.name).toBe(draft.name);expect(recovered.recovery.baseEtag).toBe(saved.etag);expect((await app.owner.request(`/api/recovery/${saved.project.id}`,'PUT',{project:older,baseEtag:saved.etag})).status).toBe(409);});
 it('exports password-encrypted portable backups, rejects tampering and restores as a new revision',async()=>{
  const app=await launch();await app.setup();const saved=await createProject(app.owner);await app.owner.request(`/api/projects/${saved.project.id}/versions`,'POST',{label:'Preserved snapshot'});const exported=await(await app.owner.request(`/api/projects/${saved.project.id}/backup/export`,'POST',{password})).json();expect(JSON.stringify(exported)).not.toContain(saved.project.name);expect(exported.backup.format).toBe('atelier.backup.v1');
  expect((await app.owner.request(`/api/projects/${saved.project.id}/backup/import`,'POST',{backup:exported.backup,password:'Incorrect password 2026'},{'If-Match':saved.etag})).status).toBe(400);const tampered=structuredClone(exported.backup);tampered.payload.ciphertext=`A${tampered.payload.ciphertext.slice(1)}`;if(tampered.payload.ciphertext===exported.backup.payload.ciphertext)tampered.payload.ciphertext=`B${tampered.payload.ciphertext.slice(1)}`;expect((await app.owner.request(`/api/projects/${saved.project.id}/backup/import`,'POST',{backup:tampered,password},{'If-Match':saved.etag})).status).toBe(400);
  const restored=await app.owner.request(`/api/projects/${saved.project.id}/backup/import`,'POST',{backup:exported.backup,password},{'If-Match':saved.etag});expect(restored.status).toBe(200);const data=await restored.json();expect(data.project.version).toBe(saved.project.version+1);expect((await(await app.owner.request(`/api/projects/${saved.project.id}/versions`)).json()).versions).toHaveLength(1);const imported=await app.owner.request('/api/backups/import','POST',{backup:exported.backup,password});expect(imported.status).toBe(201);const copy=(await imported.json()).project;expect(copy.id).not.toBe(saved.project.id);expect(copy.audit[0]).toMatchObject({actor:'Architect Owner'});expect(copy.audit[0].action).toContain('Imported a portable backup');expect(copy.audit[1].actor).toBe('Imported history');
 });
 it('migrates pilot plaintext atomically, assigns first-owner membership and removes plaintext files',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'atelier-migration-'));const project=createDemoProject();await writeFile(path.join(dir,`${project.id}.json`),JSON.stringify({project,versions:[],comments:[]}));const app=await launch(dir);const status=await(await app.owner.request('/api/auth/status')).json();expect(status.setupRequired).toBe(true);expect((await readdir(dir)).some(name=>name.endsWith('.json'))).toBe(false);await app.setup();const listing=await(await app.owner.request('/api/projects')).json();expect(listing.projects[0].id).toBe(project.id);expect(listing.permissions[project.id]).toBe('admin');
 });
 it('revokes sessions on password reset and limits repeated login attempts without revealing account data',async()=>{
  const app=await launch();await app.setup();const member=await createMember(app.owner),client=app.client();await login(client);const reset=await app.owner.request(`/api/users/${member.id}/password`,'PUT',{newPassword:'A replacement secret 2026'});expect(reset.status).toBe(200);expect((await(await client.request('/api/auth/status')).json()).authenticated).toBe(false);expect((await login(client)).status).toBe(401);expect((await login(client,'planner@example.test','A replacement secret 2026')).status).toBe(200);const diag=JSON.stringify(await(await app.owner.request('/api/diagnostics')).json());expect(diag).not.toContain('owner@example.test');expect(diag).not.toContain(password);expect(diag).not.toContain(app.directory);
  const brute=app.client();const codes=[];for(let i=0;i<10;i++)codes.push((await login(brute,'absent@example.test','Wrong credential')).status);expect(codes).toContain(429);
 },15000); // Multiple real scrypt derivations and rate-limit attempts need a bounded integration budget.
 it('keeps current access decisions when model data recovers and fails closed on credential corruption',async()=>{const app=await launch(),owner=await app.setup(),saved=await createProject(app.owner),member=await createMember(app.owner),client=app.client();await login(client);await app.owner.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:owner.id,role:'admin'},{userId:member.id,role:'reviewer'}]});const changed={...saved.project,version:saved.project.version+1,name:'Latest model'};await app.owner.request(`/api/projects/${saved.project.id}`,'PUT',changed,{'If-Match':saved.etag});await app.owner.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:owner.id,role:'admin'}]});const files=new RecordStore(app.directory,Buffer.alloc(32,12));await writeFile(files.filename(`project:${saved.project.id}`),'damaged model');expect((await client.request(`/api/projects/${saved.project.id}`)).status).toBe(404);expect((await app.owner.request(`/api/projects/${saved.project.id}`)).status).toBe(200);await app.owner.request(`/api/users/${member.id}/password`,'PUT',{newPassword:'Another reset credential 2026'});await writeFile(files.filename('accounts'),'damaged account data');expect((await app.owner.request('/api/auth/status')).status).toBe(503);expect((await app.owner.request('/api/auth/setup','POST',{name:'Attacker',email:'attacker@example.test',password})).status).toBe(503);});
 it('preserves an administrator during handover and removes the outgoing owner from every project surface',async()=>{
  const app=await launch(),owner=await app.setup(),saved=await createProject(app.owner),member=await createMember(app.owner),successor=app.client();await login(successor);
  expect((await app.owner.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:owner.id,role:'editor'},{userId:member.id,role:'reviewer'}]})).status).toBe(400);
  expect((await app.owner.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:member.id,role:'admin'}]})).status).toBe(200);
  for(const route of [`/api/projects/${saved.project.id}`,`/api/projects/${saved.project.id}/members`,`/api/projects/${saved.project.id}/member-candidates`,`/api/projects/${saved.project.id}/versions`,`/api/recovery/${saved.project.id}`])expect((await app.owner.request(route)).status).toBe(404);
  expect((await app.owner.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:owner.id,role:'admin'}]})).status).toBe(404);
  expect((await app.owner.request(`/api/projects/${saved.project.id}/backup/export`,'POST',{password})).status).toBe(404);
  expect((await(await successor.request(`/api/projects/${saved.project.id}`)).json()).role).toBe('admin');
  expect((await successor.request(`/api/projects/${saved.project.id}/member-candidates`)).status).toBe(200);expect((await successor.request('/api/users')).status).toBe(403);
 });
 it('prevents contributor lock removal and never recovers an older permission map',async()=>{
  const app=await launch(),owner=await app.setup(),saved=await createProject(app.owner),member=await createMember(app.owner),planner=app.client();await login(planner);
  await app.owner.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:owner.id,role:'admin'},{userId:member.id,role:'contributor'}]});
  const locked={...structuredClone(saved.project),version:saved.project.version+1};locked.constraints.lockedElementIds=[locked.elements[0].id];locked.constraints.lockedProperties=['material'];
  const latest=await(await app.owner.request(`/api/projects/${saved.project.id}`,'PUT',locked,{'If-Match':saved.etag})).json();const unlocked={...structuredClone(latest.project),version:latest.project.version+1};unlocked.constraints.lockedElementIds=[];unlocked.constraints.lockedProperties=[];
  expect((await planner.request(`/api/projects/${saved.project.id}`,'PUT',unlocked,{'If-Match':latest.etag})).status).toBe(403);
  expect((await planner.request(`/api/recovery/${saved.project.id}`,'PUT',{project:unlocked,baseEtag:latest.etag})).status).toBe(403);
  const files=new RecordStore(app.directory,Buffer.alloc(32,12));await writeFile(files.filename(`access:${saved.project.id}`),'damaged current access');expect((await app.owner.request(`/api/projects/${saved.project.id}`)).status).toBe(503);expect((await planner.request(`/api/projects/${saved.project.id}`)).status).toBe(503);
 });
 it('rejects inconsistent backup history and redacts malformed JSON fragments',async()=>{
  const app=await launch();await app.setup();const saved=await createProject(app.owner),exported=await(await app.owner.request(`/api/projects/${saved.project.id}/backup/export`,'POST',{password})).json();
  const {importPortableBackup,exportPortableBackup}=await import('../server/storage'),decoded=await importPortableBackup(exported.backup,password),record=decoded.value as {versions:unknown[]};record.versions=[{id:'snapshot-foreign',label:'Invalid foreign snapshot',actor:'Fixture',timestamp:new Date().toISOString(),project:{...saved.project,id:'another-project'}}];
  const inconsistent=await exportPortableBackup(saved.project.id,record,password);expect((await app.owner.request('/api/backups/import','POST',{backup:inconsistent,password})).status).toBe(400);
  const fragment='private-password-fragment-that-must-not-be-reflected';const malformed=await fetch(app.origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:`{"password":"${fragment}",BROKEN`});expect(malformed.status).toBe(400);const response=await malformed.text();expect(response).not.toContain(fragment);expect(JSON.parse(response).code).toBe('INVALID_JSON');
 });
});
