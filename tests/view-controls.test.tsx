// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useState} from 'react';
import ViewControls from '../src/components/ViewControls';
import ModelViewport from '../src/components/ModelViewport';
import PlanEditor from '../src/components/PlanEditor';
import type {ModelViewportProps} from '../src/components/PlanEditor';
import {createDemoProject} from '../src/domain/seed';
import {defaultViewState} from '../src/model/viewState';
import type {ProjectViewState,SavedModelView} from '../src/model/viewState';
import {emptyPlanningContext} from '../src/domain/planning';

beforeAll(()=>{
 vi.stubGlobal('PointerEvent',MouseEvent);vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 Object.defineProperty(SVGSVGElement.prototype,'createSVGPoint',{configurable:true,value(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};}});
 Object.defineProperty(SVGSVGElement.prototype,'getScreenCTM',{configurable:true,value(){return{inverse(){return{};}};}});
 Object.defineProperty(SVGSVGElement.prototype,'getBoundingClientRect',{configurable:true,value(){return{x:0,y:0,width:1000,height:700,left:0,right:1000,top:0,bottom:700,toJSON(){return{};}};}});
});

afterEach(cleanup);
const saved=(levelId:string):SavedModelView=>({id:'saved-plan',name:'Ground detail',viewMode:'plan',levelId,hiddenIds:[],isolatedIds:[],plan:{x:1,y:2,width:8,height:6,rotation:90}});
function controlProps(){const project=createDemoProject(),state=defaultViewState(project);state.savedViews=[saved(project.levels[0].id)];return{project,viewMode:'plan' as const,selectedIds:[],levelId:project.levels[0].id,hiddenIds:[],isolatedIds:[],state,canEdit:true,onChange:vi.fn(),capture:()=>({plan:{x:2,y:3,width:8,height:6,rotation:0}}),onRestore:vi.fn(),onAction:vi.fn(),openKey:1};}
function viewportProps():ModelViewportProps{const project=createDemoProject(),room=project.elements.find(element=>element.kind==='room')!;project.elements=[{...room,id:'near',name:'Near',x:0,y:0,width:4,depth:3},{...room,id:'far',name:'Far',x:30,y:20,width:4,depth:3}];return{project,viewMode:'plan',selectedIds:[],onSelect:vi.fn(),activeLevelId:project.levels[0].id,tool:'select',onCreate:vi.fn(),onUpdate:vi.fn(),showGrid:false,ghostUpper:false,fitKey:0};}
const viewbox=(container:HTMLElement)=>container.querySelector('svg.plan-svg')!.getAttribute('viewBox')!.split(' ').map(Number);

describe('Precision tools and named views',()=>{
 it('saves exact captured coordinates and restores a selected named view',()=>{
  const props={...controlProps(),contextHiddenIds:['layer-hidden-element']};render(<ViewControls {...props}/>);
  fireEvent.change(screen.getByRole('textbox',{name:'New view name'}),{target:{value:'Window detail'}});fireEvent.click(screen.getByRole('button',{name:'Save current view'}));
  const next=props.onChange.mock.calls[0][0] as ProjectViewState;expect(next.savedViews.at(-1)).toMatchObject({name:'Window detail',viewMode:'plan',levelId:props.levelId,contextHiddenIds:['layer-hidden-element'],plan:{x:2,y:3,width:8,height:6,rotation:0}});
  fireEvent.change(screen.getByRole('combobox',{name:'Saved view'}),{target:{value:'saved-plan'}});fireEvent.click(screen.getByRole('button',{name:'Restore view'}));expect(props.onRestore).toHaveBeenCalledWith(props.state.savedViews[0]);
 });
 it('enforces read-only persistence while permitting restore and measurement',()=>{
  const props={...controlProps(),canEdit:false};render(<ViewControls {...props}/>);
  expect((screen.getByRole('button',{name:'Apply view settings'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('textbox',{name:'New view name'}) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Measure distance'}));expect(props.onAction).toHaveBeenCalledWith('measure');
  fireEvent.change(screen.getByRole('combobox',{name:'Saved view'}),{target:{value:'saved-plan'}});fireEvent.click(screen.getByRole('button',{name:'Restore view'}));expect(props.onRestore).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'Delete saved view'}));expect(props.onChange).not.toHaveBeenCalled();
 });
 it('blocks missing-floor restores and malformed box settings without dropping existing saved views',()=>{
  const props=controlProps();props.state.savedViews[0].levelId='removed';render(<ViewControls {...props}/>);
  fireEvent.change(screen.getByRole('combobox',{name:'Saved view'}),{target:{value:'saved-plan'}});fireEvent.click(screen.getByRole('button',{name:'Restore view'}));expect(screen.getByRole('alert').textContent).toMatch(/removed floor/);expect(props.onRestore).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('spinbutton',{name:'Section min x'}),{target:{value:'1000'}});fireEvent.click(screen.getByRole('button',{name:'Apply view settings'}));expect(screen.getByRole('alert').textContent).toMatch(/maximums/);expect(props.onChange).not.toHaveBeenCalled();
 });
 it('measures two actual plan world points for a reviewer and cancels the point tool with Escape',()=>{
  const props=viewportProps(),write=vi.fn(),{container}=render(<ModelViewport {...props} canEditViewState={false} onViewStateChange={write}/>);
  fireEvent.click(screen.getByText('View tools'));fireEvent.click(screen.getByRole('button',{name:'Measure distance'}));const svg=container.querySelector('svg.plan-svg')!;
  fireEvent.pointerDown(svg,{button:0,clientX:0,clientY:0});fireEvent.pointerDown(svg,{button:0,clientX:3,clientY:4});
  expect(screen.getByLabelText('Measured distance').textContent).toMatch(/5.00 m.*world distance/);expect(write).not.toHaveBeenCalled();expect(props.onCreate).not.toHaveBeenCalled();expect(props.onUpdate).not.toHaveBeenCalled();
  fireEvent.keyDown(window,{key:'Escape'});expect(screen.queryByLabelText('Measured distance')).toBeNull();
 });
 it('honours a measurement command supplied when a model viewport first mounts',()=>{
  const props=viewportProps(),write=vi.fn(),{container}=render(<ModelViewport {...props} canEditViewState={false} onViewStateChange={write} navigationRequest={{id:1,action:'measure'}}/>),svg=container.querySelector('svg.plan-svg')!;
  fireEvent.pointerDown(svg,{button:0,clientX:0,clientY:0});fireEvent.pointerDown(svg,{button:0,clientX:3,clientY:4});
  expect(screen.getByLabelText('Measured distance').textContent).toMatch(/5.00 m.*world distance/);expect(write).not.toHaveBeenCalled();expect(props.onSelect).not.toHaveBeenCalled();expect(props.onCreate).not.toHaveBeenCalled();
 });
 it('saves a panned/zoomed plan frame and restores it after later navigation without touching the model',()=>{
  const props=viewportProps(),before=JSON.stringify(props.project.elements),write=vi.fn();
  function Harness(){const [project,setProject]=useState(props.project);return <ModelViewport {...props} project={project} canEditViewState onViewStateChange={state=>{write(state);setProject({...project,viewState:state});}}/>;}
  const {container}=render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));const captured=viewbox(container);
  fireEvent.click(screen.getByText('View tools'));fireEvent.change(screen.getByRole('textbox',{name:'New view name'}),{target:{value:'Close plan'}});fireEvent.click(screen.getByRole('button',{name:'Save current view'}));
  const state=write.mock.calls[0][0] as ProjectViewState,view=state.savedViews[0];expect(view.plan?.width).toBeCloseTo(captured[2]);
  fireEvent.click(screen.getByRole('button',{name:'Fit all'}));expect(viewbox(container)[2]).toBeGreaterThan(captured[2]);fireEvent.change(screen.getByRole('combobox',{name:'Saved view'}),{target:{value:view.id}});fireEvent.click(screen.getByRole('button',{name:'Restore view'}));
  const restored=viewbox(container);expect(restored[0]).toBeCloseTo(captured[0]);expect(restored[1]).toBeCloseTo(captured[1]);expect(restored[2]).toBeCloseTo(captured[2]);expect(JSON.stringify(props.project.elements)).toBe(before);
 });
 it('uses configured snapping for drawing and leaves free coordinates untouched when disabled',()=>{
  const props=viewportProps();props.project.viewState=defaultViewState(props.project);props.project.viewState.snapping={enabled:true,grid:true,step:1,objects:false,axes:false};const {container,rerender}=render(<PlanEditor {...props} tool="room"/>),svg=container.querySelector('svg.plan-svg')!;
  fireEvent.pointerDown(svg,{button:0,clientX:.2,clientY:.2});fireEvent.pointerMove(svg,{button:0,clientX:2.3,clientY:1.8});fireEvent.pointerUp(svg,{button:0,clientX:2.3,clientY:1.8});expect(props.onCreate).toHaveBeenLastCalledWith(expect.objectContaining({x:0,y:0,width:2,depth:2}));
  props.project={...props.project,viewState:{...props.project.viewState,snapping:{...props.project.viewState.snapping,enabled:false}}};rerender(<PlanEditor {...props} tool="room"/>);
  fireEvent.pointerDown(svg,{button:0,clientX:.2,clientY:.2});fireEvent.pointerMove(svg,{button:0,clientX:2.3,clientY:1.8});fireEvent.pointerUp(svg,{button:0,clientX:2.3,clientY:1.8});const created=(props.onCreate as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];expect(created.x).toBeCloseTo(.2);expect(created.y).toBeCloseTo(.2);expect(created.width).toBeCloseTo(2.1);expect(created.depth).toBeCloseTo(1.6);
 });
 it('rotates the displayed plan to entered true north and preserves canonical world coordinates',()=>{
  const props=viewportProps();props.project.planning={...emptyPlanningContext(),northAngle:90};const before=JSON.stringify(props.project),{container}=render(<PlanEditor {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Align true north'}));expect(container.querySelector('g[transform^="rotate(90 "]')).not.toBeNull();expect(JSON.stringify(props.project)).toBe(before);
 });
 it('clips intersecting plan geometry and shows actual polygon area rather than a rectangle proxy',()=>{
  const props=viewportProps();props.project.elements[0].footprint=[{x:0,y:0},{x:4,y:0},{x:0,y:3}];props.project.viewState=defaultViewState(props.project);props.project.viewState.sectionBox={enabled:true,min:{x:1,y:0,z:-1},max:{x:3,y:3,z:3}};
  const {container}=render(<PlanEditor {...props}/>);expect(screen.queryByRole('button',{name:'Far, room'})).toBeNull();expect(container.querySelector('clipPath rect')?.getAttribute('width')).toBe('2');expect(screen.getByText('6.0 m²')).toBeTruthy();expect(container.querySelector('g[role="button"] polygon')?.getAttribute('points')).toBe('0,0 4,0 0,3');
 });
});
