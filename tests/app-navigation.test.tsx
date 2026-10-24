// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {createDemoProject} from '../src/domain/seed';
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

describe('App familiar controls preserve text, dialog and permission boundaries',()=>{
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
});
