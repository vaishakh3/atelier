import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {Server} from 'node:http';
import {createApp} from '../server/app';
import {createDemoProject} from '../src/domain/seed';
import type {Project} from '../src/domain/types';
import {acceptScheduleRefresh,previewScheduleRefresh} from '../src/engine/modelImpact';
import {buildSchedule,generateActivities,scheduleReviewIsCurrent} from '../src/engine/schedule';
import {compareScenarios} from '../src/engine/scenarios';

const resources:{server:Server;directory:string}[]=[];
const password='Isolated construction review test 2026!';
afterEach(async()=>{for(const {server,directory}of resources.splice(0)){await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}});
async function launch(){
  const directory=await mkdtemp(path.join(tmpdir(),'atelier-schedule-review-'));
  const server=createApp({dataDir:directory,encryptionKey:Buffer.alloc(32,31),requireIdentity:true}).listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));resources.push({server,directory});const address=server.address();if(!address||typeof address==='string')throw new Error('Listener failed');
  const origin=`http://127.0.0.1:${address.port}`;let cookie='';
  const request=async(route:string,method='GET',body?:unknown,etag?:string)=>{
    const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...(etag?{'If-Match':etag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const issued=response.headers.get('set-cookie');if(issued)cookie=issued.split(';')[0];return response;
  };
  const setup=await request('/api/auth/setup','POST',{name:'Planner review fixture',email:'review@example.test',password});expect(setup.status).toBe(201);
  return{request};
}
function fixture(reviewed=false){const p=createDemoProject();p.schedule.activities=generateActivities(p);for(const allowance of p.allowances)if(allowance.amount===null)allowance.amount=1000;return reviewed?acceptScheduleRefresh(p,previewScheduleRefresh(p),'editor'):p;}
async function save(request:Awaited<ReturnType<typeof launch>>['request'],project:Project,etag?:string){const response=await request(etag?`/api/projects/${project.id}`:'/api/projects',etag?'PUT':'POST',project,etag);expect(response.status).toBe(etag?200:201);return await response.json() as {project:Project;etag:string};}

describe('server-enforced construction scope lifecycle',()=>{
  it('marks direct legacy-model geometry writes for review without replacing planner activities',async()=>{
    const {request}=await launch(),original=await save(request,fixture()),changed=structuredClone(original.project);
    changed.elements.find(e=>e.kind==='wall')!.width+=1;changed.version++;delete changed.schedule.modelReview;delete changed.schedule.modelReviewRequired;
    const saved=await save(request,changed,original.etag);expect(saved.project.schedule.modelReviewRequired).toBe(true);expect(saved.project.schedule.activities).toEqual(original.project.schedule.activities);
    expect(buildSchedule(saved.project).feasible).toBe(false);expect(compareScenarios(saved.project,'tradeoffs').every(s=>!s.feasible)).toBe(true);
  });
  it('preserves a pending review when identical-geometry clients drop both optional markers',async()=>{
    const {request}=await launch(),p=fixture();p.schedule.modelReviewRequired=true;const original=await save(request,p),changed=structuredClone(original.project);
    delete changed.schedule.modelReview;delete changed.schedule.modelReviewRequired;changed.schedule.crews=3;changed.version++;
    const saved=await save(request,changed,original.etag);expect(saved.project.elements).toEqual(original.project.elements);expect(saved.project.schedule.crews).toBe(3);expect(saved.project.schedule.modelReviewRequired).toBe(true);expect(buildSchedule(saved.project).feasible).toBe(false);
    const stripped=structuredClone(saved.project);stripped.version++;stripped.schedule.modelReviewRequired=false;
    expect((await save(request,stripped,saved.etag)).project.schedule.modelReviewRequired).toBe(true);
  });
  it('accepts an exact explicit scope review and keeps its dates valid through canonical save and read',async()=>{
    const {request}=await launch(),original=await save(request,fixture(true)),changed=structuredClone(original.project);expect(buildSchedule(original.project).feasible).toBe(true);
    changed.elements.find(e=>e.kind==='wall')!.width+=1;changed.version++;
    const pending=await save(request,changed,original.etag);expect(pending.project.schedule.modelReviewRequired).toBe(true);
    const accepted=acceptScheduleRefresh(pending.project,previewScheduleRefresh(pending.project),'editor');accepted.version++;
    const saved=await save(request,accepted,pending.etag),response=await request(`/api/projects/${saved.project.id}`),reopened=(await response.json()).project as Project;
    expect(reopened.schedule.modelReviewRequired).toBe(false);expect(scheduleReviewIsCurrent(reopened)).toBe(true);expect(buildSchedule(reopened).feasible).toBe(true);expect(buildSchedule(reopened).durationDays).toBe(buildSchedule(accepted).durationDays);
  });
  it('does not clear a forced review by replaying the unchanged historical stamp',async()=>{
    const {request}=await launch(),p=fixture(true);p.schedule.modelReviewRequired=true;const original=await save(request,p),replayed=structuredClone(original.project);
    replayed.schedule.modelReviewRequired=false;replayed.version++;
    const saved=await save(request,replayed,original.etag);expect(saved.project.schedule.modelReviewRequired).toBe(true);expect(buildSchedule(saved.project).feasible).toBe(false);
    const accepted=acceptScheduleRefresh(saved.project,previewScheduleRefresh(saved.project),'editor');accepted.version++;
    expect((await save(request,accepted,saved.etag)).project.schedule.modelReviewRequired).toBe(false);
  });
  it('allows coherent reviewed historical snapshots without invalidating their exact restored model/network',async()=>{
    const {request}=await launch(),original=await save(request,fixture(true)),changed=structuredClone(original.project);changed.elements[0].width+=1;changed.version++;
    const pending=await save(request,changed,original.etag),restored={...structuredClone(original.project),version:pending.project.version+1};
    const saved=await save(request,restored,pending.etag);expect(saved.project.elements).toEqual(original.project.elements);expect(saved.project.schedule.modelReview).toEqual(original.project.schedule.modelReview);expect(buildSchedule(saved.project).feasible).toBe(true);
  });
  it('requires a fresh scope review for current-project and new-project backup restores while retaining protected history',async()=>{
    const {request}=await launch(),original=await save(request,fixture(true));
    expect((await request(`/api/projects/${original.project.id}/versions`,'POST',{label:'Protected reviewed snapshot'})).status).toBe(201);
    const exported=await request(`/api/projects/${original.project.id}/backup/export`,'POST',{password});expect(exported.status).toBe(200);const {backup}=await exported.json();
    const changed=structuredClone(original.project);changed.elements[0].width+=1;changed.version++;const pending=await save(request,changed,original.etag);
    const restoredResponse=await request(`/api/projects/${original.project.id}/backup/import`,'POST',{backup,password},pending.etag);expect(restoredResponse.status).toBe(200);const restored=(await restoredResponse.json()).project as Project;
    expect(restored.elements).toEqual(original.project.elements);expect(restored.schedule.modelReviewRequired).toBe(true);expect(restored.schedule.modelReview).toEqual(original.project.schedule.modelReview);expect(buildSchedule(restored).feasible).toBe(false);
    const restoredRead=await request(`/api/projects/${restored.id}`);expect(restoredRead.headers.get('etag')).toBe(restoredResponse.headers.get('etag'));
    const history=await(await request(`/api/projects/${original.project.id}/versions`)).json();expect(history.versions).toHaveLength(1);expect(history.versions[0].label).toBe('Protected reviewed snapshot');expect(buildSchedule(history.versions[0].project).feasible).toBe(true);
    const importedResponse=await request('/api/backups/import','POST',{backup,password});expect(importedResponse.status).toBe(201);const imported=(await importedResponse.json()).project as Project;
    expect(imported.id).not.toBe(original.project.id);expect(imported.schedule.modelReviewRequired).toBe(true);expect(buildSchedule(imported).feasible).toBe(false);expect(imported.audit[0].action).toMatch(/Imported a portable backup/);
    const importedRead=await request(`/api/projects/${imported.id}`);expect(importedRead.headers.get('etag')).toBe(importedResponse.headers.get('etag'));
  });
});
