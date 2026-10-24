import {describe,expect,it,vi} from 'vitest';
import {Vector3} from 'three';
import {createDemoProject} from '../src/domain/seed';
import {projectSchema} from '../src/domain/schema';
import {cameraSnapshotSchema,commitViewState,defaultViewState,facadeView,measureDistance,savedViewIssues,sectionBoxSchema,sectionContainsPoint,sectionIntersectsElement,snapViewPoint,siteViewVertices,viewportWorldBounds,viewStateSchema} from '../src/model/viewState';
import type {SavedModelView} from '../src/model/viewState';
import {sectionClippingPlanes} from '../src/components/ModelViewport';

describe('Persisted precision-view state',()=>{
 it('roundtrips named camera and plan views, precision and clipping without altering architectural geometry',()=>{
  const project=createDemoProject(),before=JSON.stringify(project.elements),state=defaultViewState(project);
  state.savedViews=[{id:'view-camera',name:'South approach',viewMode:'3d',levelId:project.levels[0].id,hiddenIds:[],isolatedIds:[],camera:{position:[20,8,30],target:[4,1,3],up:[0,1,0]}},{id:'view-plan',name:'North plan',viewMode:'plan',levelId:project.levels[0].id,hiddenIds:['wall-n-00'],isolatedIds:[],plan:{x:-2,y:1,width:12,height:8,rotation:90}}];
  project.viewState=state;const parsed=projectSchema.parse(JSON.parse(JSON.stringify(project)));expect(parsed.viewState).toEqual(state);expect(parsed.elements).toEqual(project.elements);expect(JSON.stringify(project.elements)).toBe(before);
 });
 it('rejects singular camera vectors, inverted section boxes and invalid snap steps',()=>{
  expect(cameraSnapshotSchema.safeParse({position:[0,0,0],target:[0,1,0],up:[0,1,0]}).success).toBe(false);
  expect(cameraSnapshotSchema.safeParse({position:[0,0,0],target:[0,0,0],up:[0,1,0]}).success).toBe(false);
  const state=defaultViewState(createDemoProject());state.sectionBox.max.x=state.sectionBox.min.x;expect(viewStateSchema.safeParse(state).success).toBe(false);
  state.sectionBox.max.x+=1;state.snapping.step=0;expect(viewStateSchema.safeParse(state).success).toBe(false);
 });
 it('prevents read-only persistence while allowing validation of restored current-floor views',()=>{
  const project=createDemoProject(),state=defaultViewState(project),write=vi.fn();expect(()=>commitViewState(state,false,write)).toThrow(/authorised/);expect(write).not.toHaveBeenCalled();
  const view:SavedModelView={id:'view',name:'Missing floor',viewMode:'plan',levelId:'removed-level',hiddenIds:[],isolatedIds:[],plan:{x:0,y:0,width:10,height:8}};expect(savedViewIssues(project,view).join(' ')).toMatch(/removed floor/);
  view.levelId=project.levels[0].id;expect(savedViewIssues(project,view)).toEqual([]);commitViewState(state,true,write);expect(write).toHaveBeenCalledWith(state);
 });
 it('constructs six real X/Z/Y clipping planes that retain inside points and reject every outside side',()=>{
  const box={enabled:true,min:{x:1,y:2,z:3},max:{x:5,y:7,z:11}},planes=sectionClippingPlanes(box);
  expect(planes).toHaveLength(6);const inside={x:2,y:4,z:8};expect(sectionContainsPoint(box,inside)).toBe(true);expect(planes.every(plane=>plane.distanceToPoint(new Vector3(inside.x,inside.z,inside.y))>=0)).toBe(true);
  for(const outside of [{x:0,y:4,z:8},{x:6,y:4,z:8},{x:2,y:1,z:8},{x:2,y:8,z:8},{x:2,y:4,z:2},{x:2,y:4,z:12}]){expect(sectionContainsPoint(box,outside)).toBe(false);expect(planes.some(plane=>plane.distanceToPoint(new Vector3(outside.x,outside.z,outside.y))<0)).toBe(true);}
  expect(sectionClippingPlanes({...box,enabled:false})).toEqual([]);
 });
 it('keeps intersecting elements for geometric clipping even when their centre lies outside the box',()=>{
  const project=createDemoProject(),element={...project.elements[0],x:0,y:0,z:0,width:10,depth:10,height:3},box={enabled:true,min:{x:0,y:0,z:0},max:{x:1,y:1,z:1}};
  expect(sectionIntersectsElement(box,element)).toBe(true);expect(sectionIntersectsElement(box,{...element,x:20})).toBe(false);
 });
 it('measures 3D world distance and honours snapping disable/grid/object/axis settings on real polygon vertices',()=>{
  expect(measureDistance({x:0,y:0,z:0},{x:3,y:4,z:12})).toBe(13);
  const project=createDemoProject(),source=project.elements.find(element=>element.kind==='room')!;project.elements=[{...source,id:'triangle',x:-5,y:2,width:4,depth:2,rotation:90,footprint:[{x:0,y:0},{x:4,y:0},{x:2,y:2}]}];
  const settings=defaultViewState(project).snapping;
  expect(snapViewPoint(project,{x:.14,y:.26},{...settings,step:.1},{levelId:source.levelId}).point).toEqual({x:.1,y:.30000000000000004});
  expect(snapViewPoint(project,{x:.14,y:.26},{...settings,enabled:false},{levelId:source.levelId}).point).toEqual({x:.14,y:.26});
  const object=snapViewPoint(project,{x:-4.98,y:6.02},{...settings,objects:true},{levelId:source.levelId,tolerance:.1});expect(object.source).toBe('object');expect(object.point.x).toBeCloseTo(-5);expect(object.point.y).toBeCloseTo(6);
  const axis=snapViewPoint(project,{x:10.04,y:12.3},{...settings,grid:false,axes:true},{levelId:source.levelId,origin:{x:10,y:10},tolerance:.1});expect(axis.point).toEqual({x:10,y:12.3});expect(axis.guides).toEqual([{axis:'x',value:10}]);
 });
 it('aligns selected hosted openings to their actual wall facade',()=>{
  const project=createDemoProject(),opening=project.elements.find(element=>element.id==='window-n1-00')!,wall=project.elements.find(element=>element.id===opening.hostId)!;
  expect(facadeView(project,[opening.id])).toEqual(facadeView(project,[wall.id]));expect(facadeView(project,['room-living'])).toBeNull();
 });
 it('includes placed context-only and terrain extents in inspection bounds without creating BIM quantities',()=>{
  const project=createDemoProject();project.elements=[];project.site={schemaVersion:1,latitude:null,longitude:null,utcOffsetHours:5.5,trueNorthAngle:0,datumElevation:0,source:'Survey',contexts:[],terrain:{source:'Survey',vertices:[{x:1000,y:2000,z:100},{x:1010,y:2010,z:110},{x:1000,y:2010,z:100}],faces:[[0,1,2]]}};
  const points=siteViewVertices(project),bounds=viewportWorldBounds(project.elements,points);expect(bounds).toEqual({minX:1000,minY:2000,minZ:100,maxX:1010,maxY:2010,maxZ:110});expect(project.elements).toEqual([]);
  const box=defaultViewState(project).sectionBox;expect(box.min.x).toBeLessThan(1000);expect(box.max.y).toBeGreaterThan(2010);
 });
});
