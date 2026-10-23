import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {Server} from 'node:http';
import {createApp} from '../server/app';
import {RecordStore} from '../server/storage';
import {UsageService,usageEvents} from '../server/usage';
import {createDemoProject} from '../src/domain/seed';

const resources:{server:Server;directory:string}[]=[];
const password='A private local usage account 2026';
afterEach(async()=>{for(const {server,directory}of resources.splice(0)){await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}});
async function launch(){
 const directory=await mkdtemp(path.join(tmpdir(),'atelier-usage-')),key=Buffer.alloc(32,74),server=createApp({dataDir:directory,requireIdentity:true,encryptionKey:key}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));resources.push({server,directory});const address=server.address();if(!address||typeof address==='string')throw new Error('Listener failed');
 const client=()=>{let cookie='';return async(route:string,method='GET',body?:unknown)=>{const response=await fetch(`http://127.0.0.1:${address.port}`+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});const issued=response.headers.get('set-cookie');if(issued)cookie=issued.split(';')[0];return response;};};
 const owner=client();const setup=await owner('/api/auth/setup','POST',{name:'Private Studio Owner',email:'owner-private@example.test',password});expect(setup.status).toBe(201);return{directory,key,owner,client,user:(await setup.json()).user};
}

describe('local encrypted aggregate usage instrumentation',()=>{
 it('requires identity, accepts only fixed fields and persists counters without content or identifiers',async()=>{
  const app=await launch(),anonymous=app.client();expect((await anonymous('/api/usage','POST',{event:'project_created'})).status).toBe(401);
  expect((await app.owner('/api/usage','POST',{event:'ai_proposed',durationMs:120})).status).toBe(202);expect((await app.owner('/api/usage','POST',{event:'ai_proposed',durationMs:80})).status).toBe(202);
  for(const invalid of [{event:'arbitrary-event'},{event:'ai_proposed',prompt:'A confidential model prompt'},{event:'document_exported',path:'/private/studio/project.ifc'},{event:'undo',durationMs:-1},{event:'undo',durationMs:86_400_001},{event:'undo',durationMs:1.5}])expect((await app.owner('/api/usage','POST',invalid)).status).toBe(400);
  const diagnostics=await(await app.owner('/api/diagnostics')).json();expect(diagnostics.usage.counts.ai_proposed).toBe(2);expect(diagnostics.usage.durationMs.ai_proposed).toEqual({total:200,samples:2});expect(Object.keys(diagnostics.usage.counts).sort()).toEqual([...usageEvents].sort());
  const store=new RecordStore(app.directory,app.key),raw=await readFile(store.filename('usage'),'utf8');expect(JSON.parse(raw).format).toBe('atelier.aes-gcm.v1');expect(raw).not.toContain('ai_proposed');for(const privateText of ['Private Studio Owner','owner-private@example.test',app.user.id,'confidential model prompt','/private/studio']){expect(raw).not.toContain(privateText);expect(JSON.stringify(diagnostics.usage)).not.toContain(privateText);}
  const reloaded=new UsageService(new RecordStore(app.directory,app.key));expect((await reloaded.snapshot()).counts.ai_proposed).toBe(2);
 });
 it('checks actual project membership and restricts diagnostics to the workspace administrator',async()=>{
  const app=await launch(),project=createDemoProject();expect((await app.owner('/api/projects','POST',project)).status).toBe(201);const created=await app.owner('/api/users','POST',{name:'Local Reviewer',email:'reviewer@example.test',password}),reviewerId=(await created.json()).user.id,reviewer=app.client();expect((await reviewer('/api/auth/login','POST',{email:'reviewer@example.test',password})).status).toBe(200);
  expect((await reviewer('/api/usage','POST',{event:'document_exported',projectId:project.id})).status).toBe(404);expect((await reviewer('/api/diagnostics')).status).toBe(403);
  expect((await app.owner(`/api/projects/${project.id}/members`,'PUT',{members:[{userId:app.user.id,role:'admin'},{userId:reviewerId,role:'reviewer'}]})).status).toBe(200);
  expect((await reviewer('/api/usage','POST',{event:'document_exported',projectId:project.id})).status).toBe(202);expect((await reviewer('/api/usage','POST',{event:'undo',projectId:'../accounts'})).status).toBe(400);
  const usage=(await(await app.owner('/api/diagnostics')).json()).usage;expect(usage.counts.document_exported).toBe(1);expect(JSON.stringify(usage)).not.toContain(project.id);expect(JSON.stringify(usage)).not.toContain(reviewerId);
 });
 it('serializes concurrent increments and caps aggregates before integer overflow',async()=>{
  const app=await launch(),responses=await Promise.all(Array.from({length:24},(_,index)=>app.owner('/api/usage','POST',{event:'scenario_compared',durationMs:index+1})));expect(responses.every(response=>response.status===202)).toBe(true);
  const before=(await(await app.owner('/api/diagnostics')).json()).usage;expect(before.counts.scenario_compared).toBe(24);expect(before.durationMs.scenario_compared).toEqual({samples:24,total:300});
  const store=new RecordStore(app.directory,app.key),record=await store.read<{schemaVersion:1;counts:Record<string,number>;durationMs:Record<string,{samples:number;total:number}>}>('usage');record.counts.undo=999_999_999;record.durationMs.undo={samples:999_999_999,total:Number.MAX_SAFE_INTEGER-1};await store.write('usage',record);const service=new UsageService(store);
  await Promise.all([service.increment('undo',10,'fixture'),service.increment('undo',10,'fixture')]);const capped=await service.snapshot();expect(capped.counts.undo).toBe(1_000_000_000);expect(capped.durationMs.undo).toEqual({samples:1_000_000_000,total:Number.MAX_SAFE_INTEGER});expect(Object.keys(capped.counts)).toHaveLength(10);
 });
});
