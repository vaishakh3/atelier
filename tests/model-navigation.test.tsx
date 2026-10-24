// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import PlanEditor,{visibleViewportElements} from '../src/components/PlanEditor';
import type {ModelViewportProps} from '../src/components/PlanEditor';
import {FitCamera,viewportCameraFrame} from '../src/components/ModelViewport';
import {createDemoProject} from '../src/domain/seed';
import {PerspectiveCamera,Vector3} from 'three';

const cameraContext=vi.hoisted(()=>({state:undefined as unknown}));
vi.mock('@react-three/fiber',async importOriginal=>({...await importOriginal<typeof import('@react-three/fiber')>(),useThree:()=>cameraContext.state}));

beforeAll(()=>{
 vi.stubGlobal('PointerEvent',MouseEvent);
 Object.defineProperty(SVGSVGElement.prototype,'createSVGPoint',{configurable:true,value(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};}});
 Object.defineProperty(SVGSVGElement.prototype,'getScreenCTM',{configurable:true,value(){return{inverse(){return{};}};}});
 Object.defineProperty(SVGSVGElement.prototype,'getBoundingClientRect',{configurable:true,value(){return{x:0,y:0,width:1000,height:700,left:0,right:1000,top:0,bottom:700,toJSON(){return{};}};}});
});
afterEach(cleanup);
function fixture():ModelViewportProps {
 const project=createDemoProject(),room=project.elements.find(element=>element.kind==='room')!;
 project.elements=[{...room,id:'near',name:'Near room',x:0,y:0,width:4,depth:3},{...room,id:'far',name:'Far room',x:30,y:20,width:4,depth:3},{...room,id:'upper',name:'Upper distant room',levelId:'level-1',x:1000,y:1000,width:4,depth:3,z:3.2}];
 return{project,selectedIds:['near'],onSelect:vi.fn(),viewMode:'plan',activeLevelId:'level-0',tool:'select',onCreate:vi.fn(),onUpdate:vi.fn(),showGrid:false,ghostUpper:false,fitKey:0,onCancelInteraction:vi.fn()};
}
const box=(svg:Element)=>svg.getAttribute('viewBox')!.split(' ').map(Number);

describe('Familiar non-destructive model navigation',()=>{
 it('fits the selected visible element separately from all elements on the active floor',()=>{
  const props=fixture(),snapshot=JSON.stringify(props.project),{container}=render(<PlanEditor {...props}/>),svg=container.querySelector('svg.plan-svg')!;
  const all=box(svg);expect(all[2]).toBeLessThan(50); // upper-floor offset must not shrink this floor to a dot
  fireEvent.click(screen.getByRole('button',{name:'Fit selection'}));const selected=box(svg);
  expect(selected[2]).toBeLessThan(all[2]/2);expect(selected[0]+selected[2]/2).toBeCloseTo(2);expect(selected[1]+selected[3]/2).toBeCloseTo(1.5);
  fireEvent.click(screen.getByRole('button',{name:'Fit all'}));expect(box(svg)).toEqual(all);
  expect(JSON.stringify(props.project)).toBe(snapshot);expect(props.onCreate).not.toHaveBeenCalled();expect(props.onUpdate).not.toHaveBeenCalled();
 });
 it('handles external focus requests without refocusing whenever the selection changes',()=>{
  const props=fixture(),{container,rerender}=render(<PlanEditor {...props} fitSelectionKey={0}/>),svg=container.querySelector('svg.plan-svg')!,all=box(svg);
  rerender(<PlanEditor {...props} selectedIds={['far']} fitSelectionKey={0}/>);expect(box(svg)).toEqual(all);
  rerender(<PlanEditor {...props} selectedIds={['far']} fitSelectionKey={1}/>);const focused=box(svg);expect(focused[0]+focused[2]/2).toBeCloseTo(32);expect(focused[1]+focused[3]/2).toBeCloseTo(21.5);
  rerender(<PlanEditor {...props} fitSelectionKey={1} fitKey={1}/>);expect(box(svg)).toEqual(all);
 });
 it.each(['plan','section','elevation'] as const)('honours an explicit focus request when %s mounts from another workspace',viewMode=>{
  const props={...fixture(),project:createDemoProject(),viewMode,selectedIds:['wall-w-00']};
  const baseline=render(<PlanEditor {...props} fitSelectionKey={0}/>),all=box(baseline.container.querySelector('svg.plan-svg,svg.projection-svg')!);baseline.unmount();
  const mounted=render(<div>Other workspace</div>);mounted.rerender(<PlanEditor {...props} fitSelectionKey={1}/>);
  const focused=box(mounted.container.querySelector('svg.plan-svg,svg.projection-svg')!);expect(focused[2]).toBeLessThan(all[2]);expect(focused[0]+focused[2]/2).toBeLessThan(all[0]+all[2]/2);
 });
 it('honours selection focus after a batched show-all and focus request',()=>{
  const props=fixture(),{container,rerender}=render(<PlanEditor {...props} hiddenIds={['near']} fitSelectionKey={0}/>);
  expect((screen.getByRole('button',{name:'Fit selection'}) as HTMLButtonElement).disabled).toBe(true);
  rerender(<PlanEditor {...props} hiddenIds={[]} fitSelectionKey={1}/>);
  const focused=box(container.querySelector('svg.plan-svg')!);expect(focused[0]+focused[2]/2).toBeCloseTo(2);expect(focused[1]+focused[3]/2).toBeCloseTo(1.5);expect(focused[2]).toBeLessThan(10);
 });
 it('applies initial and simultaneous show-all focus requests to the real 3D camera without changing geometry',()=>{
  const props=fixture(),snapshot=JSON.stringify(props.project),camera=new PerspectiveCamera(36,1,.05,2000),controlsRef={current:{target:new Vector3(),update:vi.fn()}};
  cameraContext.state={camera,invalidate:vi.fn(),size:{width:1000,height:700}};
  const mounted=render(<div>Other workspace</div>);mounted.rerender(<FitCamera props={props} controlsRef={controlsRef} view="perspective" selectionKey={1}/>);
  expect(controlsRef.current.target.toArray()).toEqual([2,.01,1.5]);
  mounted.rerender(<FitCamera props={{...props,fitKey:1}} controlsRef={controlsRef} view="perspective" selectionKey={1}/>);expect(controlsRef.current.target.x).toBeGreaterThan(500);
  mounted.rerender(<FitCamera props={{...props,fitKey:1,hiddenIds:[]}} controlsRef={controlsRef} view="perspective" selectionKey={2}/>);expect(controlsRef.current.target.toArray()).toEqual([2,.01,1.5]);
  const position=camera.position.clone();mounted.rerender(<FitCamera props={{...props,selectedIds:['far'],fitKey:1,hiddenIds:[]}} controlsRef={controlsRef} view="perspective" selectionKey={2}/>);expect(camera.position.toArray()).toEqual(position.toArray());
  expect(JSON.stringify(props.project)).toBe(snapshot);
 });
 it('disables selection focus when selection is empty, hidden or belongs to another floor',()=>{
  const props=fixture(),{rerender}=render(<PlanEditor {...props} selectedIds={[]}/>);
  expect((screen.getByRole('button',{name:'Fit selection'}) as HTMLButtonElement).disabled).toBe(true);
  rerender(<PlanEditor {...props} selectedIds={['upper']}/>);expect((screen.getByRole('button',{name:'Fit selection'}) as HTMLButtonElement).disabled).toBe(true);
  rerender(<PlanEditor {...props} hiddenIds={['near']}/>);expect((screen.getByRole('button',{name:'Fit selection'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole('button',{name:'Near room, room'})).toBeNull();
 });
 it('pans with the right mouse button over geometry without selecting or moving it',()=>{
  const props=fixture(),{container}=render(<PlanEditor {...props}/>),svg=container.querySelector('svg.plan-svg')!,before=box(svg);
  fireEvent.pointerDown(screen.getByRole('button',{name:'Near room, room'}),{button:2,clientX:100,clientY:100,pointerId:1});
  fireEvent.pointerMove(svg,{button:2,clientX:200,clientY:150,pointerId:1});fireEvent.pointerUp(svg,{button:2,clientX:200,clientY:150,pointerId:1});
  expect(box(svg)[0]).toBeLessThan(before[0]);expect(props.onSelect).not.toHaveBeenCalled();expect(props.onUpdate).not.toHaveBeenCalled();
 });
 it('zooms by buttons and wheel and cancels a pending drag with Escape before pointer-up',()=>{
  const props=fixture(),{container}=render(<PlanEditor {...props}/>),svg=container.querySelector('svg.plan-svg')!,before=box(svg);
  fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));expect(box(svg)[2]).toBeLessThan(before[2]);
  fireEvent.wheel(svg,{deltaY:-50,clientX:2,clientY:2});expect(box(svg)[2]).toBeLessThan(before[2]/1.2);
  fireEvent.pointerDown(screen.getByRole('button',{name:'Near room, room'}),{button:0,clientX:1,clientY:1,pointerId:1});fireEvent.pointerMove(svg,{button:0,clientX:4,clientY:3,pointerId:1});
  fireEvent.keyDown(window,{key:'Escape'});fireEvent.pointerUp(svg,{button:0,clientX:4,clientY:3,pointerId:1});
  expect(props.onUpdate).not.toHaveBeenCalled();expect(props.onSelect).toHaveBeenLastCalledWith([]);expect(props.onCancelInteraction).toHaveBeenCalledOnce();
 });
 it('cancels an in-progress drawing and ignores Escape while entering text elsewhere',()=>{
  const props=fixture(),{container}=render(<><PlanEditor {...props} tool="wall"/><input aria-label="Project note"/></>),svg=container.querySelector('svg.plan-svg')!;
  fireEvent.pointerDown(svg,{button:0,clientX:0,clientY:0,pointerId:1});fireEvent.pointerMove(svg,{button:0,clientX:4,clientY:0,pointerId:1});fireEvent.keyDown(window,{key:'Escape'});fireEvent.pointerUp(svg,{button:0,clientX:4,clientY:0,pointerId:1});
  expect(props.onCreate).not.toHaveBeenCalled();expect(props.onCancelInteraction).toHaveBeenCalledOnce();
  fireEvent.keyDown(screen.getByRole('textbox',{name:'Project note'}),{key:'Escape'});expect(props.onCancelInteraction).toHaveBeenCalledOnce();
 });
 it('keeps explicit top and South camera axes, and fits portrait views without a fixed distance cap',()=>{
  const project=fixture().project,elements=[{...project.elements[0],x:-10,y:20,z:5,width:4,depth:6,height:3}];
  const top=viewportCameraFrame(elements,'top',1),south=viewportCameraFrame(elements,'front',1);
  expect(top.target.toArray()).toEqual([-8,6.5,23]);expect(top.position.x).toBe(-8);expect(top.position.z).toBe(23);expect(top.position.y).toBeGreaterThan(6.5);expect(top.up.toArray()).toEqual([0,0,-1]);
  expect(south.position.x).toBe(-8);expect(south.position.y).toBe(6.5);expect(south.position.z).toBeGreaterThan(23);expect(south.up.toArray()).toEqual([0,1,0]);
  expect(viewportCameraFrame(elements,'perspective',.3).distance).toBeGreaterThan(viewportCameraFrame(elements,'perspective',2).distance);
  expect(viewportCameraFrame([{...elements[0],width:1000}],'perspective',1).distance).toBeGreaterThan(150);
 });
 it('provides the same focus and zoom controls on orthographic projected views',()=>{
  const project=createDemoProject(),props={...fixture(),project,viewMode:'elevation' as const,selectedIds:['window-s1-00']},snapshot=JSON.stringify(project),{container}=render(<PlanEditor {...props}/>),svg=container.querySelector('svg.projection-svg')!,all=box(svg);
  fireEvent.click(screen.getByRole('button',{name:'Fit selection'}));expect(box(svg)[2]).toBeLessThan(all[2]);
  fireEvent.click(screen.getByRole('button',{name:'Fit all'}));expect(box(svg)).toEqual(all);expect(JSON.stringify(project)).toBe(snapshot);expect(props.onUpdate).not.toHaveBeenCalled();
 });
 it('hides hosted openings with walls and isolates selected openings with host context without changing data',()=>{
  const project=createDemoProject(),snapshot=JSON.stringify(project),window=project.elements.find(element=>element.id==='window-n1-00')!,wall=project.elements.find(element=>element.id===window.hostId)!;
  const hidden=visibleViewportElements(project,[wall.id]);expect(hidden.some(element=>element.id===window.id||element.id===wall.id)).toBe(false);
  const isolated=visibleViewportElements(project,[],[window.id]);expect(isolated.map(element=>element.id).sort()).toEqual([wall.id,window.id].sort());
  expect(visibleViewportElements(project,[],[wall.id]).some(element=>element.id===window.id)).toBe(true);expect(JSON.stringify(project)).toBe(snapshot);
 });
});
