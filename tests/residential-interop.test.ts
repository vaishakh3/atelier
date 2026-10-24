import {describe,expect,it} from 'vitest';
import {createBlankProject} from '../src/domain/seed';
import {previewLayout} from '../src/domain/layout';
import type {LayoutRequest,LayoutRoom} from '../src/domain/types';
import {projectSchema} from '../src/domain/schema';
import {exportIfc,importIfc} from '../src/io/ifc';
import {quantities} from '../src/engine/quantities';
import {validateModelGeometry} from '../src/model/geometry';

const room=(key:string,use:LayoutRoom['use'],floor:0|1,attachedTo:string|null=null):LayoutRoom=>({key,name:key,use,area:null,attachedTo,floor});
const programme=[room('living','living',0),room('dining','dining',0),room('kitchen','kitchen',0),room('common-bath','bathroom',0),room('pool','pool',0),room('library','study',0),...Array.from({length:4},(_,i)=>[room(`bed-${i+1}`,'bedroom',1),room(`ensuite-${i+1}`,'bathroom',1,`bed-${i+1}`)]).flat()];
const request:LayoutRequest={idPrefix:'interop-two-storey',levelId:'level-0',footprintId:null,width:null,depth:null,rooms:programme,storeys:2,floorHeight:3.2};

describe('two-storey concept interoperability and measurements',()=>{
 it('round-trips both storeys, the coordinated stair and separate upper slab pieces through IFC',()=>{
  const source=createBlankProject('Two-storey round trip'),preview=previewLayout(source,request);
  expect(preview.issues).toEqual([]);expect(preview.levels).toHaveLength(1);
  const candidate={...source,levels:[...source.levels,...preview.levels],elements:preview.elements};
  expect(projectSchema.safeParse(candidate).success).toBe(true);
  expect(validateModelGeometry(candidate).filter(issue=>issue.severity==='error')).toEqual([]);
  const stair=candidate.elements.filter(element=>element.kind==='stair');expect(stair).toHaveLength(1);
  const upper=candidate.levels.find(level=>level.id!==source.levels[0].id)!;
  expect(stair[0].z+stair[0].height).toBeCloseTo(upper.elevation,6);
  const upperSlabs=candidate.elements.filter(element=>element.levelId===upper.id&&element.kind==='slab');
  expect(upperSlabs.length).toBeGreaterThan(1);
  const {project:restored,report}=importIfc(exportIfc(candidate),createBlankProject('Import target'));
  expect(report.excluded).toBe(0);expect(report.referenceOnly).toBe(0);expect(report.imported).toBe(candidate.elements.length);
  expect(restored.levels.map(level=>level.elevation).sort()).toEqual(candidate.levels.map(level=>level.elevation).sort());
  for(const original of candidate.elements){
   const imported=restored.elements.find(element=>element.id===original.id)!;expect(imported).toBeDefined();expect(imported.kind).toBe(original.kind);
   for(const field of ['x','y','z','width','depth','height','rotation'] as const)expect(imported[field],`${original.name} ${field}`).toBeCloseTo(original[field],5);
   expect(imported.hostId).toBe(original.hostId);
   expect(restored.levels.find(level=>level.id===imported.levelId)?.elevation).toBe(candidate.levels.find(level=>level.id===original.levelId)?.elevation);
  }
 });

 it('measures the upper floor as its actual slab pieces and preserves the full programme on both floors',()=>{
  const source=createBlankProject('Measured upper void'),preview=previewLayout(source,request);
  expect(preview.issues).toEqual([]);
  const candidate={...source,levels:[...source.levels,...preview.levels],elements:preview.elements},lines=quantities(candidate);
  expect(lines.flatMap(line=>line.issues)).toEqual([]);
  for(const requested of programme){
   const planned=candidate.elements.filter(element=>element.kind==='room'&&element.properties.layoutKey===requested.key);expect(planned).toHaveLength(1);
   const level=candidate.levels.find(level=>level.id===planned[0].levelId)!;expect(level.elevation).toBeCloseTo(requested.floor!*3.2);
  }
  const upper=preview.floors[1],slabs=candidate.elements.filter(element=>element.kind==='slab'&&element.levelId===upper.level.id);
  const physicalArea=slabs.reduce((sum,slab)=>sum+slab.width*slab.depth,0);
  expect(physicalArea).toBeGreaterThan(0);expect(physicalArea).toBeLessThan(upper.footprint.width*upper.footprint.depth);
  const measured=lines.filter(line=>slabs.some(slab=>slab.id===line.elementId));expect(measured).toHaveLength(slabs.length);
  for(const line of measured){const slab=slabs.find(slab=>slab.id===line.elementId)!;expect(line.quantity).toBeCloseTo(line.unit==='m³'?slab.width*slab.depth*slab.height:slab.width*slab.depth,5);}
 });
});
