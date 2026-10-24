import {describe,expect,it} from 'vitest';
import {projectSchema} from '../src/domain/schema';
import {previewLayout} from '../src/domain/layout';
import {createBlankProject} from '../src/domain/seed';
import type {BimElement} from '../src/domain/types';
import {localToWorld} from '../src/model/geometry';
import {FURNITURE_CATALOG} from '../src/interior/catalog';
import {interiorStateSchema,interiorReferenceSchema} from '../src/interior/schema';
import {createFurniturePlacement,furnitureFit,interiorState,removeFurniturePlacement,suggestRoomArrangement,updateFurniturePlacement} from '../src/interior/model';
import type {FurniturePlacement} from '../src/interior/types';
const room=(patch:Partial<BimElement>={}):BimElement=>({id:'living',name:'Living',kind:'room',levelId:'level-0',typeId:'room',material:'Air',x:0,y:0,z:0,width:5,depth:4,height:2.8,rotation:0,editable:true,properties:{use:'living'},...patch});
function house(patch:Partial<BimElement>={}){const project=createBlankProject('Interior QA');project.elements=[room(patch)];return project;}
const placement=(patch:Partial<FurniturePlacement>={}):FurniturePlacement=>({id:'furniture-1',assetId:'ikea-kivik-3-seat',roomId:'living',levelId:'level-0',x:2.5,y:2,rotation:0,...patch});
describe('dimensioned source-linked interiors',()=>{
 it('adds, adjusts and removes only furniture while preserving the complete architectural snapshots',()=>{
  const project=house(),before=structuredClone(project),one=createFurniturePlacement(project,placement());expect(project).toEqual(before);expect(one.elements).toBe(project.elements);expect(one.levels).toBe(project.levels);expect(one.audit).toBe(project.audit);expect(interiorState(one).placements).toHaveLength(1);expect(one.version).toBe(before.version);
  const next=updateFurniturePlacement(one,'furniture-1',{x:2.7,rotation:20});expect(interiorState(one).placements[0].x).toBe(2.5);expect(interiorState(next).placements[0].x).toBe(2.7);expect(interiorState(removeFurniturePlacement(next,'furniture-1')).placements).toEqual([]);expect(next.elements).toEqual(before.elements);
 });
 it('validates world-centred furniture against rotated rooms instead of a world axis bounding box',()=>{
  const project=house({x:10,y:-4,rotation:37}),r=project.elements[0],centre=localToWorld(r,2.5,2);expect(furnitureFit(project,placement({...centre,rotation:37})).valid).toBe(true);expect(furnitureFit(project,placement({x:10,y:-4,rotation:37})).valid).toBe(false);
 });
 it('rejects furniture crossing a concave polygon even if all four corners are inside',()=>{
  const project=house({width:4,depth:4,footprint:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:2.1,y:4},{x:2.1,y:1},{x:1.9,y:1},{x:1.9,y:4},{x:0,y:4}]});
  expect(furnitureFit(project,placement({x:2,y:2,assetId:'ikea-klippan-2-seat'})).issues.join(' ')).toContain('outside');
 });
 it('blocks overlap, hidden wall/stair crossings and conservative doorway clearance',()=>{
  let project=createFurniturePlacement(house(),placement());expect(furnitureFit(project,placement({id:'second',x:2.7})).issues.join(' ')).toContain('overlaps');
  project=house();project.elements.push(room({id:'partition',kind:'wall',x:2.45,y:0,width:.1,depth:4,name:'Internal partition'}));expect(furnitureFit(project,placement()).issues.join(' ')).toContain('Internal partition');
  project=house();project.elements.push(room({id:'door',kind:'door',name:'Entry',x:2,y:0,width:1,depth:.15,height:2.1}));expect(furnitureFit(project,placement({assetId:'ikea-lack-side-table',x:2.5,y:.8})).issues.join(' ')).toContain('doorway clearance');expect(furnitureFit(project,placement({assetId:'ikea-lack-side-table',x:4,y:3})).valid).toBe(true);
 });
 it('rejects wrong levels, overheight and invalid values with no partial mutation',()=>{
  const project=house({height:1.9}),before=structuredClone(project);expect(furnitureFit(project,placement({assetId:'ikea-billy-bookcase'})).issues.join(' ')).toContain('height');expect(furnitureFit(project,placement({levelId:'missing'})).valid).toBe(false);expect(furnitureFit(project,placement({x:NaN})).valid).toBe(false);expect(()=>createFurniturePlacement(project,placement({x:-10}))).toThrow();expect(project).toEqual(before);
 });
 it('keeps architectural saves possible when a room edit makes existing furniture stale, and exposes the fit issue',()=>{
  const project=createFurniturePlacement(house(),placement()),changed={...project,elements:project.elements.map(e=>({...e,width:1}))};expect(projectSchema.safeParse(changed).success).toBe(true);expect(interiorState(changed).placements).toHaveLength(1);expect(furnitureFit(changed,interiorState(changed).placements[0]).issues.join(' ')).toContain('outside');
 });
 it('selects a real smaller sofa where the larger SKU cannot fit and never scales a catalog item',()=>{
  const project=house({width:2.15,depth:1.4}),before=structuredClone(project),suggestion=suggestRoomArrangement(project,'living','japandi');expect(suggestion.placements.find(p=>FURNITURE_CATALOG.find(a=>a.id===p.assetId)?.category==='sofa')?.assetId).toBe('ikea-klippan-2-seat');expect(suggestion.notes.join(' ')).toContain('listed size');expect(suggestion.issues.join(' ')).toContain('Omitted');for(const item of suggestion.placements)expect(furnitureFit(project,item,suggestion.placements).valid).toBe(true);expect(project).toEqual(before);
 });
 it('preserves existing room furniture, respects other-room clashes and is repeatable',()=>{
  const project=createFurniturePlacement(house(),placement()),before=structuredClone(project),a=suggestRoomArrangement(project,'living','modern'),b=suggestRoomArrangement(project,'living','modern');expect(a).toEqual(b);expect(a.placements.every(p=>p.assetId!=='ikea-kivik-3-seat'&&p.assetId!=='ikea-klippan-2-seat')).toBe(true);for(const item of a.placements)expect(furnitureFit(project,item,[...interiorState(project).placements,...a.placements]).valid).toBe(true);expect(project).toEqual(before);
  project.elements.push(room({id:'other-room',name:'Other room'}));expect(furnitureFit(project,placement({id:'other-furniture',roomId:'other-room'})).issues.join(' ')).toContain('overlaps');
 });
 it('furnishes generated area-marker rooms on both floors using wall-derived height',()=>{
  const project=createBlankProject('Generated house'),preview=previewLayout(project,{levelId:'level-0',footprintId:null,width:14,depth:13,idPrefix:'interior-native',storeys:2,rooms:[{key:'living',name:'Living',use:'living',area:null,attachedTo:null,floor:0},{key:'study',name:'Study',use:'study',area:null,attachedTo:null,floor:0},{key:'bedroom',name:'Bedroom',use:'bedroom',area:null,attachedTo:null,floor:1}]});expect(preview.issues).toEqual([]);project.elements=preview.elements;project.levels=[...project.levels,...preview.levels];
  for(const r of project.elements.filter(e=>e.kind==='room'&&['living','study','bedroom'].includes(String(e.properties.use)))){expect(r.height).toBe(.02);const suggestion=suggestRoomArrangement(project,r.id,'japandi');expect(suggestion.placements.length).toBeGreaterThan(0);for(const item of suggestion.placements){const fit=furnitureFit(project,item,suggestion.placements);expect(fit.valid).toBe(true);expect(fit.warnings.join(' ')).toContain('area marker');}}
 });
 it('honours room and geometry locks for mutations and automatic suggestions',()=>{
  const project=house();project.constraints.lockedElementIds=['living'];expect(()=>createFurniturePlacement(project,placement())).toThrow('locked');expect(suggestRoomArrangement(project,'living','japandi').placements).toEqual([]);project.constraints.lockedElementIds=[];const withItem=createFurniturePlacement(project,placement());withItem.constraints.lockedProperties=['interior'];expect(()=>removeFurniturePlacement(withItem,'furniture-1')).toThrow('locked');
 });
 it('accepts only bounded sourced placements and raster references with unique IDs',()=>{
  expect(FURNITURE_CATALOG).toHaveLength(9);for(const asset of FURNITURE_CATALOG){expect(asset.source.url).toMatch(/^https:\/\/www\.ikea\.com\/in\/en\/p\//);expect(asset.source.availability).toBe('unverified');expect(Math.min(asset.width,asset.depth,asset.height)).toBeGreaterThan(0);}
  expect(interiorStateSchema.safeParse({...interiorState(house()),placements:[placement(),placement()]}).success).toBe(false);expect(interiorStateSchema.safeParse({...interiorState(house()),placements:[placement({assetId:'invented'})]}).success).toBe(false);
  const ref={id:'ref1',name:'Moodboard',styleId:'japandi',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWHsAAAAASUVORK5CYII='};expect(interiorReferenceSchema.safeParse(ref).success).toBe(true);expect(interiorReferenceSchema.safeParse({...ref,dataUrl:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='}).success).toBe(false);expect(interiorReferenceSchema.safeParse({...ref,dataUrl:`data:image/png;base64,iVBORw0KGgo${'A'.repeat(1500000)}`}).success).toBe(false);
 });
});
