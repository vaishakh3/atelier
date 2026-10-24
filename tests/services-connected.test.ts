import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {Server} from 'node:http';
import {createApp} from '../server/app';
import {createBlankProject} from '../src/domain/seed';
import {projectSchema} from '../src/domain/schema';
import {auditProject} from '../src/domain/transactions';
import {acceptServicesDemoProject,createServicesDemoProject} from '../src/services/demo';
import {acceptServiceProposal,previewServiceRoomSwap,servicePlanIsCurrent} from '../src/services/model';
import {calculateServiceEstimate} from '../src/services/calculations';
import {acceptScheduleRefresh,invalidateScheduleReview,previewScheduleRefresh} from '../src/engine/modelImpact';
import {buildSchedule,estimate,quantities} from '../src/engine';
import {buildReviewPdf,buildWorkbook} from '../src/io/exports';
import {buildServicesReport,buildServicesSvg,createServicesDrawing} from '../src/services/exports';
import {compareRevisions} from '../src/engine/revisions';
import type {Project} from '../src/domain/types';

function pricedDemo(){
 const p=createServicesDemoProject(createBlankProject('Connected services journey'));
 p.services!.assumptions.rateSource='Isolated test assumptions — not a quotation';p.services!.assumptions.rateDate='2026-10-24';
 p.services!.assumptions.rates=p.services!.assumptions.rates.map(r=>({...r,material:r.unit==='m'?180:650,labour:r.unit==='m'?75:250,productivity:r.unit==='m'?35:8}));
 return p;
}
function moveBathroom(p:Project){return previewServiceRoomSwap(p,'services-house-space-bath-upper','services-house-space-study');}
const resources:{server:Server;directory:string}[]=[];
afterEach(async()=>{for(const resource of resources.splice(0)){if(resource.server.listening)await new Promise<void>(resolve=>resource.server.close(()=>resolve()));await rm(resource.directory,{recursive:true,force:true});}});
async function launch(directory:string){const app=createApp({dataDir:directory,requireIdentity:true,encryptionKey:Buffer.alloc(32,41)}),server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));resources.push({server,directory});const address=server.address();if(!address||typeof address==='string')throw Error('No listener');const origin=`http://127.0.0.1:${address.port}`;let cookie='';return{server,request:async(route:string,method='GET',body?:unknown,headers:Record<string,string>={})=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return r;}};}

describe('connected house → services → bathroom change → review journey',()=>{
 it('previews an exact empty-only house, then changes real hosted connections and reviewed construction dates',()=>{
  const empty=createBlankProject('House'),snapshot=JSON.stringify(empty),demo=createServicesDemoProject(empty);
  expect(JSON.stringify(empty)).toBe(snapshot);expect(demo.levels).toHaveLength(2);expect(demo.elements.filter(e=>e.kind==='room'&&e.properties.use==='bedroom')).toHaveLength(4);
  expect(acceptServicesDemoProject(empty,snapshot,demo,'editor')).toEqual(demo);
  expect(()=>acceptServicesDemoProject(empty,snapshot,demo,'reviewer')).toThrow();
  const altered=structuredClone(demo);altered.description='Changed';expect(()=>acceptServicesDemoProject(empty,snapshot,altered,'admin')).toThrow(/changed/i);
  expect(()=>createServicesDemoProject(demo)).toThrow(/empty/i);
  let before=pricedDemo();before=acceptScheduleRefresh(before,previewScheduleRefresh(before),'admin');
  const beforeSnapshot=structuredClone(before),candidate=moveBathroom(before),old=before.services!,next=candidate.services!;
  expect(before).toEqual(beforeSnapshot);expect(next.routes.filter(r=>JSON.stringify(r)!==JSON.stringify(old.routes.find(o=>o.id===r.id))).length).toBeGreaterThan(0);
  expect(candidate.elements.filter(e=>['wall','door','window','slab','stair'].includes(e.kind)).map(({properties,...e})=>e)).toEqual(before.elements.filter(e=>['wall','door','window','slab','stair'].includes(e.kind)).map(({properties,...e})=>e));
  expect(candidate.elements.filter(e=>e.properties.use==='bedroom')).toHaveLength(4);
  expect(calculateServiceEstimate(candidate,next).total).toBeGreaterThan(calculateServiceEstimate(before,old).total!);
  const accepted=acceptServiceProposal(before,JSON.stringify(before),candidate,'editor');
  const pending=invalidateScheduleReview(before,accepted);expect(buildSchedule(pending).feasible).toBe(false);
  const reviewed=acceptScheduleRefresh(pending,previewScheduleRefresh(pending,before),'editor');
  expect(buildSchedule(reviewed).feasible).toBe(true);expect(buildSchedule(reviewed).durationDays).toBeGreaterThan(buildSchedule(before).durationDays);
  expect(compareRevisions(before,reviewed).projectChanges.some(change=>change.field==='services')).toBe(true);
  const undo=auditProject({...before,version:reviewed.version,audit:reviewed.audit},'Undo transaction');
  expect(undo.services).toEqual(before.services);expect(undo.elements).toEqual(before.elements);expect(buildSchedule(undo).feasible).toBe(true);
  const redo=auditProject({...reviewed,version:undo.version,audit:undo.audit},'Redo transaction');expect(redo.services).toEqual(reviewed.services);expect(buildSchedule(redo).finishDate).toBe(buildSchedule(reviewed).finishDate);
 });
 it('exports service sources, calculations, drawings and explicit limitations with the project',()=>{
  const p=pricedDemo(),cost=estimate(p),schedule=buildSchedule(p),report=buildServicesReport(p),wb=buildWorkbook(p,quantities(p),cost,schedule);
  expect(report.current).toBe(true);expect(report.plan).toEqual(p.services);expect(wb.SheetNames).toEqual(expect.arrayContaining(['Service points','Service routes','Service rates','Service review','Service calculations']));
  p.name='<script>alert(1)</script>';const svg=buildServicesSvg(p,p.levels[1].id,['drainage']);expect(svg).not.toContain('<script>');expect(svg).toContain('&lt;script&gt;');expect(svg).toContain('polyline');
  expect(createServicesDrawing(p,p.levels[1].id).primitives.some(primitive=>primitive.elementId===p.services!.routes.find(r=>r.system==='drainage'&&p.services!.points.some(point=>point.id===r.fromId&&point.levelId===p.levels[1].id))?.id)).toBe(true);
  const pdf=buildReviewPdf(p,cost,schedule,quantities(p));expect(pdf.getNumberOfPages()).toBeGreaterThan(8);expect(pdf.output()).toContain('Services coordination');
 });
 it('lets contributors price existing services while denying route changes and service deletion',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'atelier-services-role-')),app=await launch(directory),password='Isolated integration passphrase 2026!';
  const ownerResponse=await app.request('/api/auth/setup','POST',{name:'Owner',email:'owner-services@example.test',password});const owner=(await ownerResponse.json()).user;
  const created=await app.request('/api/projects','POST',pricedDemo());let saved=await created.json()as{project:Project;etag:string};
  const memberResponse=await app.request('/api/users','POST',{name:'Estimator',email:'estimator-services@example.test',password,isAdmin:false});const member=(await memberResponse.json()).user;
  expect((await app.request(`/api/projects/${saved.project.id}/members`,'PUT',{members:[{userId:owner.id,role:'admin'},{userId:member.id,role:'contributor'}]})).status).toBe(200);
  expect((await app.request('/api/auth/login','POST',{email:'estimator-services@example.test',password})).status).toBe(200);
  const priced=structuredClone(saved.project);priced.version++;priced.services!.assumptions.rates[0].material=123;
  const allowed=await app.request(`/api/projects/${priced.id}`,'PUT',priced,{'If-Match':saved.etag});expect(allowed.status).toBe(200);saved=await allowed.json();
  const changed=structuredClone(saved.project);changed.version++;changed.services!.points[0].offset.x+=.1;
  expect((await app.request(`/api/projects/${changed.id}`,'PUT',changed,{'If-Match':saved.etag})).status).toBe(403);
  const removed=structuredClone(saved.project);removed.version++;delete removed.services;
  expect((await app.request(`/api/projects/${removed.id}`,'PUT',removed,{'If-Match':saved.etag})).status).toBe(403);
 });
 it('saves, rejects stale writes, restarts encrypted identity storage and preserves the exact accepted services',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'atelier-services-connected-')),password='Isolated integration passphrase 2026!',email='services-integration@example.test';
  const first=await launch(directory);expect((await first.request('/api/auth/setup','POST',{name:'Services integration',email,password})).status).toBe(201);
  const initial=pricedDemo();const created=await first.request('/api/projects','POST',initial);expect(created.status).toBe(201);const saved=await created.json()as{project:Project;etag:string};
  const next=auditProject(moveBathroom(saved.project),'Relocated upper bathroom function');expect(projectSchema.safeParse(next).success).toBe(true);
  const response=await first.request(`/api/projects/${initial.id}`,'PUT',next,{'If-Match':saved.etag});expect(response.status).toBe(200);const committed=await response.json()as{project:Project};
  expect((await first.request(`/api/projects/${initial.id}`,'PUT',next,{'If-Match':saved.etag})).status).toBe(409);
  const raw=await Promise.all((await readdir(directory)).filter(name=>name.endsWith('.atelier')).map(name=>readFile(path.join(directory,name),'utf8')));expect(raw.join('')).not.toContain('Connected services journey');expect(raw.join('')).not.toContain(password);
  await new Promise<void>(resolve=>first.server.close(()=>resolve()));
  const second=await launch(directory);expect((await second.request('/api/auth/login','POST',{email,password})).status).toBe(200);
  const loaded=await(await second.request(`/api/projects/${initial.id}`)).json()as{project:Project};expect(loaded.project.services).toEqual(committed.project.services);expect(loaded.project.elements).toEqual(committed.project.elements);expect(servicePlanIsCurrent(loaded.project,loaded.project.services!)).toBe(true);
 });
});
