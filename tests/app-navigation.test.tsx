// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {createDemoProject} from '../src/domain/seed';
import {assignDesignLayer,createDesignLayer,updateDesignLayer} from '../src/domain/designWorkbench';
import {emptySiteContext} from '../src/site/types';
import {parseSiteObj} from '../src/site/exchange';
import {defaultViewState} from '../src/model/viewState';
import App from '../src/App';

const state=vi.hoisted(()=>({workspace:{}as Record<string,any>,auth:{}as Record<string,any>,viewport:{}as Record<string,any>}));
vi.mock('../src/domain/auth',()=>({useAuth:()=>state.auth}));
vi.mock('../src/domain/useWorkspace',()=>({useWorkspace:()=>state.workspace}));
vi.mock('../src/domain/usage',()=>({recordUsage:vi.fn()}));
vi.mock('../src/components/ModelViewport',()=>({default:(props:Record<string,any>)=>{state.viewport=props;return <div data-testid="mock-model-viewport"/>;}}));
vi.mock('../src/components/InspectorCopilot',()=>({default:()=>null}));
vi.mock('../src/components/WorkspaceSettings',()=>({default:()=>null}));
vi.mock('../src/components/EstimatePanel',()=>({default:()=>null}));
vi.mock('../src/components/SchedulePanel',()=>({default:()=>null}));
vi.mock('../src/components/ScenariosPanel',()=>({default:()=>null}));
vi.mock('../src/components/DocumentsPanel',()=>({default:()=>null}));
vi.mock('../src/components/PlanningPanel',()=>({default:()=>null}));
vi.mock('../src/components/ServicesPanel',()=>({default:()=> <h2>Services fixture</h2>}));

beforeEach(()=>{
 const project=createDemoProject();
 state.auth={authenticated:true,identityRequired:true,sessionUser:{id:'navigation-test-user',name:'Navigation fixture'}};
 state.workspace={project,projects:[project],ready:true,transitioning:false,aiReady:false,aiModel:'test-model',currentRole:'admin',versions:[],comments:[],warnings:[],recoveryCopy:null,saved:'Saved locally',error:'',canUndo:true,canRedo:true,commit:vi.fn(),undoAction:vi.fn(),redoAction:vi.fn(),flush:vi.fn(async()=>{}),newProject:vi.fn(),switchProject:vi.fn(),getCurrentProject:()=>structuredClone(project)};
 state.viewport={};
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function openPalette(){fireEvent.click(screen.getByRole('button',{name:'Quick access and model search'}));return screen.getByRole('combobox',{name:'Search commands and model elements'});}
function findUpperRoom(){const input=openPalette();fireEvent.change(input,{target:{value:'room-bed1'}});fireEvent.keyDown(input,{key:'Enter'});}
function layeredProject(){
 let project=createDemoProject();
 const hidden=parseSiteObj('v 0 0 0\nv 4 0 0\nv 0 4 0\nf 1 2 3','Hidden context.obj'),visible=parseSiteObj('v 10 0 0\nv 14 0 0\nv 10 4 0\nf 1 2 3','Visible context.obj');
 project.site={...emptySiteContext(),contexts:[hidden,visible],terrain:{source:'Survey terrain',vertices:[{x:0,y:0,z:0},{x:10,y:0,z:1},{x:0,y:10,z:0}],faces:[[0,1,2]]}};
 project=createDesignLayer(project,'Hidden rooms','design','admin');const designLayer=project.workbench!.layers.at(-1)!.id;project=assignDesignLayer(project,designLayer,['room-living'],'admin');project=updateDesignLayer(project,designLayer,{visible:false},'admin');
 project=createDesignLayer(project,'Hidden survey','context','admin');const contextLayer=project.workbench!.layers.at(-1)!.id;project=assignDesignLayer(project,contextLayer,[hidden.id,'site-terrain'],'admin');project=updateDesignLayer(project,contextLayer,{visible:false},'admin');
 return{project,hidden,visible};
}

describe('App familiar controls preserve text, dialog and permission boundaries',()=>{
 it('uses one workspace navigation rail, descriptive tooltips and persistent history controls',()=>{
  render(<App/>);
  expect(screen.queryByRole('navigation',{name:'Project views'})).toBeNull();
  const rail=screen.getByRole('navigation',{name:'Workspace navigation'});
  for(const name of ['Model','Design studio','Estimate','Schedule','Scenarios','Documents','Services','Site checks']){
   const item=within(rail).getByRole('button',{name});
   const tooltip=document.getElementById(item.getAttribute('aria-describedby')!);
   expect(tooltip?.getAttribute('role')).toBe('tooltip');expect(tooltip?.textContent?.length).toBeGreaterThan(name.length);
  }
  expect(within(rail).getByRole('button',{name:'Model'}).getAttribute('aria-current')).toBe('page');
  fireEvent.click(within(rail).getByRole('button',{name:'Services'}));
  expect(within(rail).getByRole('button',{name:'Services'}).getAttribute('aria-current')).toBe('page');
  expect(within(rail).getByRole('button',{name:'Model'}).hasAttribute('aria-current')).toBe(false);
  const header=document.querySelector('.workspace-page-header') as HTMLElement;
  expect(within(header).getByRole('heading',{name:'Services'})).toBeTruthy();
  expect(within(header).getAllByRole('button').map(button=>button.textContent)).toEqual(['Import','Export']);
  const history=screen.getByRole('group',{name:'Project history'});
  fireEvent.click(within(history).getByRole('button',{name:'Undo last transaction'}));
  fireEvent.click(within(history).getByRole('button',{name:'Redo transaction'}));
  expect(state.workspace.undoAction).toHaveBeenCalledOnce();expect(state.workspace.redoAction).toHaveBeenCalledOnce();
 });

 it('does not turn typed text, deletion or text undo into model actions',()=>{
  render(<App/>);findUpperRoom();expect(state.viewport.selectedIds).toEqual(['room-bed1']);
  const input=screen.getByRole('textbox',{name:'Filter model elements'});input.focus();
  fireEvent.keyDown(input,{key:'q'});fireEvent.keyDown(input,{key:'w'});fireEvent.keyDown(input,{key:'Delete'});fireEvent.keyDown(input,{key:'z',ctrlKey:true});
  expect(screen.queryByRole('dialog')).toBeNull();expect(state.viewport.tool).toBe('select');
  expect(state.viewport.selectedIds).toEqual(['room-bed1']);expect(state.workspace.commit).not.toHaveBeenCalled();expect(state.workspace.undoAction).not.toHaveBeenCalled();
 });

 it('keeps model shortcuts out of a focused dialog control',()=>{
  render(<App/>);findUpperRoom();
  fireEvent.click(screen.getByRole('button',{name:'Keyboard shortcuts and support'}));
  const dialog=screen.getByRole('dialog'),close=within(dialog).getByRole('button',{name:'Close dialog'});close.focus();
  fireEvent.keyDown(close,{key:'q'});fireEvent.keyDown(close,{key:'w'});fireEvent.keyDown(close,{key:'Delete'});fireEvent.keyDown(close,{key:'z',ctrlKey:true});
  expect(screen.getByRole('dialog')).toBe(dialog);expect(screen.queryByRole('combobox')).toBeNull();
  expect(state.workspace.commit).not.toHaveBeenCalled();expect(state.workspace.undoAction).not.toHaveBeenCalled();expect(state.viewport.tool).toBe('select');
 });

 it('keeps reviewer drawing and undo commands unavailable through both keyboard and palette',()=>{
  state.workspace.currentRole='reviewer';render(<App/>);
  fireEvent.keyDown(window,{key:'w'});fireEvent.keyDown(window,{key:'z',ctrlKey:true});fireEvent.keyDown(window,{key:'d',ctrlKey:true});
  expect(state.viewport.tool).toBe('select');expect(state.viewport.viewMode).toBe('3d');expect(state.workspace.undoAction).not.toHaveBeenCalled();
  const input=openPalette();fireEvent.change(input,{target:{value:'wall tool'}});
  const wall=screen.getByRole('option');expect(wall.getAttribute('aria-disabled')).toBe('true');fireEvent.click(wall);fireEvent.keyDown(input,{key:'Enter'});
  expect(state.viewport.tool).toBe('select');expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.change(input,{target:{value:'undo last'}});expect(screen.getByRole('option').getAttribute('aria-disabled')).toBe('true');fireEvent.keyDown(input,{key:'Enter'});
  expect(state.workspace.undoAction).not.toHaveBeenCalled();expect(state.workspace.commit).not.toHaveBeenCalled();
 });

 it('finds an upper-level model element from Services and focuses the correct floor',()=>{
  render(<App/>);
  fireEvent.click(within(screen.getByRole('navigation',{name:'Workspace navigation'})).getByRole('button',{name:'Services'}));
  expect(screen.getByText('Services fixture')).toBeTruthy();
  findUpperRoom();
  expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByText('Services fixture')).toBeNull();
  expect(state.viewport.selectedIds).toEqual(['room-bed1']);expect(state.viewport.activeLevelId).toBe('level-1');expect(state.viewport.fitSelectionKey).toBeGreaterThan(0);
 });

 it('restores exact saved BIM/context visibility for a reviewer without changing persistent layer state',()=>{
  const {project,hidden,visible}=layeredProject(),before=structuredClone(project);state.workspace.project=project;state.workspace.projects=[project];state.workspace.currentRole='reviewer';render(<App/>);
  expect(state.viewport.hiddenIds).toContain('room-living');expect(state.viewport.project.site.contexts.map((asset:{id:string})=>asset.id)).toEqual([visible.id]);expect(state.viewport.project.site.terrain).toBeNull();
  expect(state.viewport.contextHiddenIds).toEqual([hidden.id,'site-terrain']);expect(state.viewport.canEditViewState).toBe(false);
  act(()=>state.viewport.onViewContextChange({viewMode:'plan',levelId:'level-0',hiddenIds:['room-bed1'],isolatedIds:[],contextHiddenIds:[visible.id]}));
  expect(state.viewport.hiddenIds).toEqual(['room-bed1']);expect(state.viewport.project.site.contexts.map((asset:{id:string})=>asset.id)).toEqual([hidden.id]);expect(state.viewport.project.site.terrain).toEqual(project.site!.terrain);expect(state.viewport.contextHiddenIds).toEqual([visible.id]);
  expect(state.workspace.commit).not.toHaveBeenCalled();expect(project).toEqual(before);
  fireEvent.click(screen.getByRole('button',{name:'Use layer visibility'}));
  expect(state.viewport.hiddenIds).toEqual(['room-living']);expect(state.viewport.contextHiddenIds).toEqual([hidden.id,'site-terrain']);expect(state.viewport.project.site.contexts.map((asset:{id:string})=>asset.id)).toEqual([visible.id]);expect(state.viewport.project.site.terrain).toBeNull();
  expect(state.workspace.commit).not.toHaveBeenCalled();expect(project).toEqual(before);
 });

 it('passes the current context mask to saved-view capture and saves settings against the full unfiltered project',()=>{
  const {project,hidden,visible}=layeredProject();state.workspace.project=project;state.workspace.projects=[project];render(<App/>);
  act(()=>state.viewport.onViewContextChange({viewMode:'plan',levelId:'level-0',hiddenIds:[],isolatedIds:[],contextHiddenIds:[visible.id]}));
  expect(state.viewport.contextHiddenIds).toEqual([visible.id]);expect(state.workspace.commit).not.toHaveBeenCalled();
  const views=defaultViewState(project);views.savedViews=[{id:'recorded',name:'Inspection context',viewMode:'plan',levelId:'level-0',hiddenIds:[...state.viewport.hiddenIds],isolatedIds:[],contextHiddenIds:[...state.viewport.contextHiddenIds],plan:{x:0,y:0,width:12,height:9}}];
  act(()=>state.viewport.onViewStateChange(views));
  expect(state.workspace.commit).toHaveBeenCalledOnce();const stored=state.workspace.commit.mock.calls[0][0];expect(stored.viewState.savedViews[0].contextHiddenIds).toEqual([visible.id]);expect(stored.site.contexts.map((asset:{id:string})=>asset.id)).toEqual([hidden.id,visible.id]);expect(stored.site.terrain).toEqual(project.site!.terrain);
 });
 it('retains a direct-modelling draft while visiting the model to select geometry',()=>{render(<App/>);const rail=within(screen.getByRole('navigation',{name:'Workspace navigation'}));fireEvent.click(rail.getByRole('button',{name:'Design studio'}));const name=screen.getByRole('textbox',{name:/Geometry name/i});fireEvent.change(name,{target:{value:'Unapplied courtyard draft'}});fireEvent.click(rail.getByRole('button',{name:'Model'}));expect(screen.queryByRole('textbox',{name:/Geometry name/i})).toBeNull();fireEvent.click(rail.getByRole('button',{name:'Design studio'}));expect((screen.getByRole('textbox',{name:/Geometry name/i}) as HTMLInputElement).value).toBe('Unapplied courtyard draft');expect(state.workspace.commit).not.toHaveBeenCalled();});

});
