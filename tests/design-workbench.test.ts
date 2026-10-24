import {describe,expect,it} from 'vitest';
import {deflateSync} from 'node:zlib';
import {createDemoProject} from '../src/domain/seed';
import {projectSchema} from '../src/domain/schema';
import {acceptDesignWorkbenchChange,assignDesignLayer,assertWorkbenchLayerLocks,createDesignLayer,createDesignProposal,initializeDesignWorkbench,layerSelection,parseDesignSnapshot,proposalProject,renameDesignProposal,resolveLayerVisibility,switchDesignProposal,updateDesignLayer} from '../src/domain/designWorkbench';
import {workbenchSchema} from '../src/domain/designWorkbenchSchema';
import {emptySiteContext} from '../src/site/types';
import {rasterContext} from '../src/site/exchange';

const fixture=()=>createDemoProject();
/** A complete, valid PNG with incompressible pixels; no fake header/padding fixture. */
function largePng(){
 const width=512,height=512,raw=Buffer.alloc((width*4+1)*height);let random=0x1a2b3c4d;
 for(let row=0;row<height;row++)for(let column=1;column<=width*4;column++){random^=random<<13;random^=random>>>17;random^=random<<5;raw[row*(width*4+1)+column]=random&255;}
 const table=Array.from({length:256},(_,n)=>{let crc=n;for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;});
 const chunk=(type:string,data:Buffer)=>{const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const contents=Buffer.concat([Buffer.from(type),data]),check=Buffer.alloc(4);let crc=0xffffffff;for(const value of contents)crc=table[(crc^value)&255]^(crc>>>8);check.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,contents,check]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 return `data:image/png;base64,${Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64')}`;
}
describe('independent design proposals with a shared site base',()=>{
 it('saves current changes before cloning and switching and never nests proposal state',()=>{
  const original=fixture(),before=structuredClone(original),base=initializeDesignWorkbench(original,'editor'),first=base.workbench!.activeProposalId;
  const second=createDesignProposal(base,'Courtyard alternative','editor'),secondId=second.workbench!.activeProposalId;
  expect(original).toEqual(before);expect(secondId).not.toBe(first);expect(second.workbench!.proposals).toHaveLength(2);
  second.elements.find(element=>element.id==='room-study')!.name='Branch-only studio';
  second.types[0].materialRate=987;
  const restored=switchDesignProposal(second,first,'editor');
  expect(restored.elements.find(element=>element.id==='room-study')!.name).toBe('Studio');
  expect(restored.types[0].materialRate).toBe(before.types[0].materialRate);
  expect(proposalProject(restored,secondId).elements.find(element=>element.id==='room-study')!.name).toBe('Branch-only studio');
  const returned=switchDesignProposal(restored,secondId,'editor');
  expect(returned.types[0].materialRate).toBe(987);
  expect(returned.elements.find(element=>element.id==='room-study')!.name).toBe('Branch-only studio');
  expect(returned.workbench!.proposals.every(proposal=>!Object.hasOwn(JSON.parse(proposal.modelJson),'workbench'))).toBe(true);
  expect(returned.id).toBe(original.id);expect(returned.version).toBe(original.version);expect(returned.audit).toEqual(original.audit);
  expect(returned.schedule.modelReviewRequired).toBe(true);expect(returned.schedule.modelReview).toBeUndefined();
  expect(projectSchema.safeParse(returned).success).toBe(true);
 });

 it('preserves shared current site assets, live authorization constraints and identity across old snapshots',()=>{
  let project=initializeDesignWorkbench(fixture(),'admin');const first=project.workbench!.activeProposalId;
  project=createDesignProposal(project,'Option two','admin');project.site=emptySiteContext();project.site.latitude=10.2;project.site.source='Shared surveyed base';
  project.name='Live project name';project.constraints.budget=123456;
  const next=switchDesignProposal(project,first,'admin');
  expect(next.name).toBe('Live project name');expect(next.site).toEqual(project.site);expect(next.constraints).toEqual(project.constraints);
  expect(proposalProject(project,first).site).toEqual(project.site);
 });

 it('branches a valid site with a real image above 1 MB without copying the shared base into snapshots',()=>{
  const original=fixture(),dataUrl=largePng();expect(new TextEncoder().encode(dataUrl).length).toBeGreaterThan(1_000_000);
  original.site={...emptySiteContext(),contexts:[rasterContext(dataUrl,512,512,'Shared survey raster.png')]};
  expect(projectSchema.safeParse(original).success).toBe(true);
  let project=initializeDesignWorkbench(original,'editor');const first=project.workbench!.activeProposalId;
  for(let i=0;i<5;i++)project=createDesignProposal(project,`Option ${i+2}`,'editor');
  for(const proposal of project.workbench!.proposals){expect(new TextEncoder().encode(proposal.modelJson).length).toBeLessThan(1_000_000);expect(JSON.parse(proposal.modelJson).site).toBeUndefined();expect(proposal.modelJson).not.toContain(dataUrl);}
  expect(JSON.stringify(project).split(dataUrl)).toHaveLength(2);
  project.site!.contexts[0].placement.origin.x=11;
  const switched=switchDesignProposal(project,first,'editor');
  expect(switched.site!.contexts[0].placement.origin.x).toBe(11);expect(switched.site!.contexts[0].image!.dataUrl).toBe(dataUrl);
  expect(proposalProject(switched,switched.workbench!.proposals[1].id).site).toEqual(switched.site);
 });

 it('enforces editor roles, existing element/read-only/property locks and detached exact review baselines',()=>{
  const original=fixture();expect(()=>initializeDesignWorkbench(original,'reviewer')).toThrow(/access/);
  let project=initializeDesignWorkbench(original,'admin'),first=project.workbench!.activeProposalId;project=createDesignProposal(project,'Second','admin');
  project.elements[0].width+=1;project.constraints.lockedElementIds.push(project.elements[0].id);
  expect(()=>switchDesignProposal(project,first,'editor')).toThrow(/locked/);
  project.constraints.lockedElementIds=[];project.constraints.lockedProperties=['width'];
  expect(()=>switchDesignProposal(project,first,'editor')).toThrow(/locked/);
  project.constraints.lockedProperties=[];project.elements[0].editable=false;
  expect(()=>switchDesignProposal(project,first,'editor')).toThrow(/read-only/);
  const fresh=initializeDesignWorkbench(fixture(),'editor'),candidate=renameDesignProposal(fresh,fresh.workbench!.activeProposalId,'Renamed','editor'),snapshot=structuredClone(fresh);
  expect(acceptDesignWorkbenchChange(fresh,snapshot,candidate,'editor')).toEqual(candidate);
  fresh.description='Concurrent change';expect(()=>acceptDesignWorkbenchChange(fresh,snapshot,candidate,'editor')).toThrow(/changed after/);
 });

 it('bounds snapshot count/size, rejects invalid and recursively nested data before project validation',()=>{
  let project=initializeDesignWorkbench(fixture(),'editor');
  for(let i=0;i<5;i++)project=createDesignProposal(project,`Option ${i}`,'editor');
  expect(()=>createDesignProposal(project,'Seventh','editor')).toThrow(/six/);
  expect(()=>parseDesignSnapshot('{invalid')).toThrow(/valid JSON/);
  expect(()=>parseDesignSnapshot(JSON.stringify({...fixture(),workbench:{proposals:[]}}))).toThrow(/nested/);
  const nested=structuredClone(project.workbench!);nested.proposals[0].modelJson=JSON.stringify({...fixture(),nested:{workbench:{}}});
  expect(workbenchSchema.safeParse(nested).success).toBe(false);
  const malformed=structuredClone(project.workbench!);malformed.proposals[0].modelJson=JSON.stringify({...fixture(),elements:[{id:'bad'}]});
  expect(workbenchSchema.safeParse(malformed).success).toBe(false);
  expect(()=>parseDesignSnapshot('x'.repeat(1_000_001))).toThrow(/1 MB/);
  expect(()=>parseDesignSnapshot(JSON.stringify({text:'€'.repeat(400_000)}))).toThrow(/1 MB/);
  const oversized=fixture();oversized.elements[0].properties.longText='x'.repeat(1_000_001);
  expect(()=>createDesignProposal(oversized,'Large','editor')).toThrow(/1 MB/);
 });
});

describe('persistent design and context layers',()=>{
 it('persists explicit membership, visibility and selection independently of construction geometry',()=>{
  const original=fixture();let project=createDesignLayer(original,'External walls','design','editor'),layer=project.workbench!.layers[0];
  const ids=project.elements.filter(element=>element.kind==='wall').slice(0,2).map(element=>element.id);
  project=assignDesignLayer(project,layer.id,ids,'editor');project=updateDesignLayer(project,layer.id,{visible:false},'editor');
  expect(resolveLayerVisibility(project)).toEqual({hiddenIds:ids,contextHiddenIds:[]});expect(layerSelection(project,layer.id)).toEqual(ids);
  expect(project.elements).toEqual(original.elements);expect(project.allowances).toEqual(original.allowances);
  const reloaded=projectSchema.parse(JSON.parse(JSON.stringify(project)));
  expect(resolveLayerVisibility(reloaded).hiddenIds).toEqual(ids);
  project=assignDesignLayer(project,layer.id,[ids[0]],'editor');expect(project.workbench!.layers[0].elementIds).toEqual([ids[0]]);
 });

 it('moves explicit assignments between layers and rejects reassignment out of a locked source',()=>{
  let project=createDesignLayer(fixture(),'One','design','editor');project=createDesignLayer(project,'Two','design','editor');
  const [one,two]=project.workbench!.layers,id=project.elements[0].id;
  project=assignDesignLayer(project,one.id,[id],'editor');project=assignDesignLayer(project,two.id,[id],'editor');
  expect(project.workbench!.layers[0].elementIds).toEqual([]);expect(project.workbench!.layers[1].elementIds).toEqual([id]);
  project=updateDesignLayer(project,two.id,{locked:true},'editor');
  expect(()=>assignDesignLayer(project,one.id,[id],'editor')).toThrow(/source layer/);
  expect(()=>assignDesignLayer(project,two.id,[id],'editor')).toThrow(/destination/);
  expect(()=>assignDesignLayer(project,one.id,['unknown'],'editor')).toThrow(/existing/);
 });

 it('only removes layer-owned locks when unlocking and protects read-only context assets',()=>{
  let project=createDesignLayer(fixture(),'Locked geometry','design','admin');const layer=project.workbench!.layers[0],[manual,managed]=project.elements.slice(0,2).map(element=>element.id);
  project.constraints.lockedElementIds=[manual];project=assignDesignLayer(project,layer.id,[manual,managed],'admin');project=updateDesignLayer(project,layer.id,{locked:true},'admin');
  expect(project.constraints.lockedElementIds).toEqual([manual,managed]);
  project=updateDesignLayer(project,layer.id,{locked:false},'admin');expect(project.constraints.lockedElementIds).toEqual([manual]);
  project.site=emptySiteContext();project.site.contexts=[{id:'context-1',name:'Survey linework',format:'DXF',source:'Test reference',placement:{units:'m',scale:1,rotation:0,origin:{x:0,y:0,z:0}},vertices:[{x:0,y:0,z:0},{x:1,y:1,z:0}],faces:[],lines:[[0,1]],report:{accepted:1,excluded:0,warnings:[]}}];
  project=createDesignLayer(project,'Shared survey','context','admin');const context=project.workbench!.layers[1];project=assignDesignLayer(project,context.id,['context-1'],'admin');project=updateDesignLayer(project,context.id,{locked:true,visible:false},'admin');
  expect(resolveLayerVisibility(project).contextHiddenIds).toEqual(['context-1']);expect(layerSelection(project,context.id)).toEqual([]);
  const moved=structuredClone(project);moved.site!.contexts[0].placement.origin.x=3;
  expect(()=>assertWorkbenchLayerLocks(project,moved)).toThrow(/Context layer Shared survey is locked/);
  const removed=structuredClone(project);removed.site!.contexts=[];
  expect(()=>assertWorkbenchLayerLocks(project,removed)).toThrow(/locked/);
  project=updateDesignLayer(project,context.id,{locked:false},'admin');
  project.site!.terrain={source:'Survey points',vertices:[{x:0,y:0,z:0},{x:10,y:0,z:1},{x:0,y:10,z:2}],faces:[[0,1,2]]};
  project=assignDesignLayer(project,context.id,['context-1','site-terrain'],'admin');project=updateDesignLayer(project,context.id,{locked:true},'admin');
  expect(resolveLayerVisibility(project).contextHiddenIds).toEqual(['context-1','site-terrain']);
  const changedTerrain=structuredClone(project);changedTerrain.site!.terrain!.vertices[0].z=5;
  expect(()=>assertWorkbenchLayerLocks(project,changedTerrain)).toThrow(/locked/);
 });
});
