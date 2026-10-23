import {describe,expect,it} from 'vitest';
import {createBlankProject} from '../src/domain/seed';
import {previewLayout} from '../src/domain/layout';
import type {BimElement,LayoutRequest,LayoutRoom,Project} from '../src/domain/types';
import {footprint,localToWorld,validateModelGeometry,worldToLocal} from '../src/model/geometry';
import {quantities} from '../src/engine/quantities';

const room=(key:string,use:LayoutRoom['use'],attachedTo:string|null=null,area:number|null=null):LayoutRoom=>({key,name:key.replaceAll('-',' '),use,area,attachedTo});
const program:LayoutRoom[]=[room('bed-one','bedroom'),room('bath-one','bathroom','bed-one'),room('bed-two','bedroom'),room('bath-two','bathroom','bed-two'),room('common-bath','bathroom'),room('living','living'),room('theater','theater'),room('pool','pool')];
const request=(rooms=program):LayoutRequest=>({levelId:'level-0',footprintId:null,width:null,depth:null,rooms:structuredClone(rooms),idPrefix:'layout-test'});
function empty(){return createBlankProject('Concept layout');}
function slabProject(rotation=0){const project=empty();const type=project.types.find(type=>type.kind==='slab')!;const slab:BimElement={id:'selected-slab',kind:'slab',name:'Empty footprint',levelId:'level-0',typeId:type.id,material:type.material,x:24,y:-7,z:-.2,width:12,depth:18,height:.2,rotation,editable:true,properties:{survey:'User supplied'}};project.elements.push(slab);return{project,slab};}
function localBounds(element:BimElement,frame:{x:number;y:number;rotation:number}){const points=footprint(element).map(point=>worldToLocal(frame,point));return{minX:Math.min(...points.map(point=>point.x)),maxX:Math.max(...points.map(point=>point.x)),minY:Math.min(...points.map(point=>point.y)),maxY:Math.max(...points.map(point=>point.y))};}

describe('detached concept layout generation',()=>{
 it('generates the complete requested house program without unrequested kitchens or mutations',()=>{
  const project=empty(),input=request(),before=JSON.stringify(project),inputBefore=JSON.stringify(input),preview=previewLayout(project,input);
  expect(preview.issues).toEqual([]);expect(preview.rooms).toHaveLength(8);expect(preview.elements.filter(element=>element.kind==='room')).toHaveLength(9);
  expect(preview.elements.filter(element=>element.kind==='slab')).toHaveLength(1);expect(preview.elements.some(element=>element.kind==='roof')).toBe(false);
  expect(preview.rooms.map(item=>item.use)).not.toContain('kitchen');expect(preview.elements.length).toBeLessThanOrEqual(200);
  expect(validateModelGeometry({...project,elements:preview.elements})).toEqual([]);
  expect(JSON.stringify(project)).toBe(before);expect(JSON.stringify(input)).toBe(inputBefore);expect(previewLayout(project,input)).toEqual(preview);
  expect(preview.elements.every(element=>!element.externalId&&element.id.startsWith(input.idPrefix))).toBe(true);
  expect(quantities({...project,elements:preview.elements}).every(line=>line.issues.length===0)).toBe(true);
 });
 it('connects every primary room to circulation and each ensuite only to its named bedroom',()=>{
  const project=empty(),preview=previewLayout(project,request());expect(preview.issues).toEqual([]);
  const doors=preview.elements.filter(element=>element.kind==='door');expect(doors).toHaveLength(9);
  expect(doors.find(door=>door.id===preview.circulation!.entryDoorId)?.properties).toMatchObject({accessFrom:'outside',accessTo:'circulation'});
  for(const output of preview.rooms){
   const door=doors.find(door=>door.id===output.doorId)!;
   expect(door.properties.accessTo).toBe(output.key);expect(door.properties.accessFrom).toBe(output.attachedTo??'circulation');
   if(output.attachedTo){
    const bedroom=preview.elements.find(element=>element.id===preview.rooms.find(item=>item.key===output.attachedTo)!.elementId)!;
    const bath=preview.elements.find(element=>element.id===output.elementId)!;
    expect(bath.y-bedroom.y-bedroom.depth).toBeCloseTo(.2);expect(bath.x).toBe(bedroom.x);
    expect(preview.elements.find(element=>element.id===door.hostId)?.rotation).toBe(0);
   }else expect(preview.elements.find(element=>element.id===door.hostId)?.rotation).toBe(90);
  }
 });
 it('keeps room interiors and shared wall strips disjoint instead of double building partitions',()=>{
  const project=empty(),preview=previewLayout(project,request());expect(preview.issues).toEqual([]);
  for(const kind of ['room','wall']){
   const elements=preview.elements.filter(element=>element.kind===kind),boxes=elements.map(element=>localBounds(element,preview.footprint));
   for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++){
    const overlapX=Math.min(boxes[a].maxX,boxes[b].maxX)-Math.max(boxes[a].minX,boxes[b].minX);
    const overlapY=Math.min(boxes[a].maxY,boxes[b].maxY)-Math.max(boxes[a].minY,boxes[b].minY);
    expect(Math.max(0,overlapX)*Math.max(0,overlapY),`${elements[a].name} overlaps ${elements[b].name}`).toBeLessThan(1e-8);
   }
  }
 });
 it('retains the exact selected slab position, dimensions and rotation and contains all creations',()=>{
  const {project,slab}=slabProject(37),before=structuredClone(slab),preview=previewLayout(project,{...request(),footprintId:slab.id});
  expect(preview.issues).toEqual([]);expect(preview.footprint).toEqual({x:slab.x,y:slab.y,width:slab.width,depth:slab.depth,rotation:37,levelId:slab.levelId});
  expect(preview.elements.some(element=>element.id===slab.id||element.kind==='slab')).toBe(false);expect(slab).toEqual(before);
  for(const element of preview.elements){const bounds=localBounds(element,slab);expect(bounds.minX).toBeGreaterThanOrEqual(-1e-6);expect(bounds.minY).toBeGreaterThanOrEqual(-1e-6);expect(bounds.maxX).toBeLessThanOrEqual(slab.width+1e-6);expect(bounds.maxY).toBeLessThanOrEqual(slab.depth+1e-6);}
  expect(validateModelGeometry({...project,elements:[...project.elements,...preview.elements]})).toEqual([]);
 });
 it('blocks a too-small slab or conflicting dimensions without silently expanding it',()=>{
  const {project,slab}=slabProject();slab.width=8;slab.depth=7;const before=JSON.stringify(project);
  const failed=previewLayout(project,{...request(),footprintId:slab.id});expect(failed.elements).toEqual([]);expect(failed.issues.join(' ')).toMatch(/does not fit/);expect(JSON.stringify(project)).toBe(before);
  expect(previewLayout(project,{...request(),footprintId:slab.id,width:12}).issues.join(' ')).toMatch(/differ from the selected slab/);
 });
 it('respects explicit envelope dimensions and derives only omitted dimensions',()=>{
  const project=empty(),fixed=previewLayout(project,{...request(),width:14,depth:18});expect(fixed.issues).toEqual([]);expect(fixed.footprint.width).toBe(14);expect(fixed.footprint.depth).toBe(18);
  const fixedDepth=previewLayout(project,{...request(),depth:12});expect(fixedDepth.issues).toEqual([]);expect(fixedDepth.footprint.depth).toBe(12);expect(fixedDepth.footprint.width).toBeGreaterThan(10.4);
  expect(previewLayout(project,{...request(),width:8,depth:8}).issues.join(' ')).toMatch(/does not fit/);
 });
 it('rejects locked/read-only slabs and relevant global geometry locks',()=>{
  for(const lock of ['*','geometry','geometry.*','elements','elements.*','width','rotation','model.geometry']){
   const project=empty();project.constraints.lockedProperties=[lock];expect(previewLayout(project,request()).issues.join(' '),lock).toMatch(/locked/);
  }
  const {project,slab}=slabProject();slab.editable=false;expect(previewLayout(project,{...request(),footprintId:slab.id}).issues.join(' ')).toMatch(/read-only/);
  slab.editable=true;project.constraints.lockedElementIds=[slab.id];expect(previewLayout(project,{...request(),footprintId:slab.id}).elements).toEqual([]);
  project.constraints.lockedElementIds=[];project.constraints.lockedProperties=[slab.id+'.width'];expect(previewLayout(project,{...request(),footprintId:slab.id}).elements).toEqual([]);
 });
 it('blocks occupied rotated footprints including reference objects, but allows disjoint neighbors',()=>{
  const {project,slab}=slabProject(45),reference=structuredClone(slab),point=localToWorld(slab,2,2);reference.id='existing-reference';reference.kind='reference';reference.name='Existing imported reference';reference.x=point.x;reference.y=point.y;reference.width=1;reference.depth=1;reference.editable=false;project.elements.push(reference);
  expect(previewLayout(project,{...request(),footprintId:slab.id}).issues.join(' ')).toMatch(/occupied.*Existing imported reference/);
  reference.x+=100;expect(previewLayout(project,{...request(),footprintId:slab.id}).issues).toEqual([]);
  expect(previewLayout(project,request()).issues.join(' ')).toMatch(/empty level/);
 });
 it('uses only approved existing types and never fills unknown rates',()=>{
  const project=empty();for(const type of project.types){type.materialRate=null;type.labourRate=null;type.equipmentRate=null;}const before=JSON.stringify(project.types),preview=previewLayout(project,request());
  expect(preview.issues).toEqual([]);expect(JSON.stringify(project.types)).toBe(before);
  expect(preview.elements.every(element=>project.types.some(type=>type.id===element.typeId&&type.kind===element.kind&&type.approved))).toBe(true);
  project.types.filter(type=>type.kind==='window').forEach(type=>{type.approved=false;});expect(previewLayout(project,request()).issues.join(' ')).toMatch(/window.*Types and rates are never invented/);
 });
 it('reserves pool/garage scope explicitly without inventing specialist design or cost',()=>{
  const project=empty(),preview=previewLayout(project,request([room('pool','pool'),room('garage','garage')]));expect(preview.issues).toEqual([]);
  expect(preview.elements.filter(element=>element.kind==='room'&&element.properties.reservedZone)).toHaveLength(2);
  expect(preview.assumptions.join(' ')).toMatch(/Pool is a reserved room zone only/);expect(preview.assumptions.join(' ')).toMatch(/unpriced specialist allowance/);expect(preview.assumptions.join(' ')).toMatch(/pedestrian access only/);
  expect(project.allowances.some(allowance=>allowance.name.toLowerCase().includes('pool'))).toBe(false);
 });
 it('supports a one-room program with connected circulation and no invented second program room',()=>{
  const project=empty(),preview=previewLayout(project,request([room('study','study')]));expect(preview.issues).toEqual([]);expect(preview.rooms).toHaveLength(1);expect(preview.elements.filter(element=>element.kind==='room')).toHaveLength(2);expect(preview.rooms[0].accessFrom).toBe('circulation');
  expect(validateModelGeometry({...project,elements:preview.elements})).toEqual([]);
 });
 it('validates attachment identity/privacy and stable room keys',()=>{
  const project=empty();
  for(const rooms of [[room('one','bedroom'),room('one','bathroom')],[room('one','bathroom','missing')],[room('living','living'),room('bath','bathroom','living')],[room('bed','bedroom'),room('bath1','bathroom','bed'),room('bath2','bathroom','bed')],[room('circulation','study')]]){
   const output=previewLayout(project,request(rooms));expect(output.elements).toEqual([]);expect(output.issues.length).toBeGreaterThan(0);
  }
 });
 it('keeps metre geometry when project display units are feet and exposes actual/net target areas',()=>{
  const project=empty(),metric=previewLayout(project,request());project.units='ft';const imperial=previewLayout(project,request());expect(imperial.elements).toEqual(metric.elements);
  for(const item of imperial.rooms)expect(item.area+.001).toBeGreaterThanOrEqual(item.requestedArea);
  expect(imperial.circulation!.width).toBe(1.2);expect(imperial.assumptions.join(' ')).toMatch(/minimum net planning targets/);
 });
 it('blocks invalid requests, duplicate generated IDs and the project element cap atomically',()=>{
  const project=empty();for(const change of [{width:Infinity},{depth:3},{idPrefix:'bad id'},{levelId:'missing'},{rooms:[]},{rooms:[room('room','study',null,-2)]}])expect(previewLayout(project,{...request(),...change}).elements).toEqual([]);
  const preview=previewLayout(project,request());project.elements=preview.elements;
  // A retained slab allows footprint validation; identifier collisions are also detected independently.
  const slab=project.elements.find(element=>element.kind==='slab')!;project.elements=[{...slab,id:preview.elements.find(element=>element.kind==='wall')!.id}];
  expect(previewLayout(project,{...request(),footprintId:project.elements[0].id}).issues.join(' ')).toMatch(/already exists/);
  const capped=slabProject();const otherLevel={id:'other-level',name:'Other level',elevation:5};capped.project.levels.push(otherLevel);
  for(let index=0;index<9998;index++)capped.project.elements.push({...capped.slab,id:'old-'+index,levelId:otherLevel.id});
  expect(previewLayout(capped.project,{...request(),footprintId:capped.slab.id}).issues.join(' ')).toMatch(/10,000-project-element limit/);
 });
 it('accepts the structural baselineVersion extension without strict parsing it as room input',()=>{
  const project=empty(),withVersion={...request(),baselineVersion:project.version};expect(previewLayout(project,withVersion).issues).toEqual([]);
 });
 it('rejects ambiguous source slab and approved type identifiers',()=>{
  const project=empty();project.types.push(structuredClone(project.types[0]));expect(previewLayout(project,request()).issues.join(' ')).toMatch(/type identifier is duplicated/);
  const source=slabProject();source.project.elements.push(structuredClone(source.slab));expect(previewLayout(source.project,{...request(),footprintId:source.slab.id}).issues.join(' ')).toMatch(/slab identifier is duplicated/);
  const typeSource=slabProject();typeSource.project.types.push(structuredClone(typeSource.project.types.find(type=>type.id===typeSource.slab.typeId)!));expect(previewLayout(typeSource.project,{...request(),footprintId:typeSource.slab.id}).issues.join(' ')).toMatch(/unambiguous approved compatible slab type/);
 });
 it('normalizes created orientations without changing a retained slab and rejects coordinate overflow',()=>{
  const {project,slab}=slabProject(36000),preview=previewLayout(project,{...request(),footprintId:slab.id});expect(preview.issues).toEqual([]);expect(slab.rotation).toBe(36000);expect(preview.footprint.rotation).toBe(36000);
  expect(preview.elements.every(element=>element.rotation>=0&&element.rotation<360)).toBe(true);expect(validateModelGeometry({...project,elements:[...project.elements,...preview.elements]})).toEqual([]);
  slab.x=10_000_000;expect(previewLayout(project,{...request(),footprintId:slab.id}).issues.join(' ')).toMatch(/coordinate range/);
 });
});
