// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {createBlankProject} from '../src/domain/seed';
import {emptyPlanningContext} from '../src/domain/planning';
import {emptySiteContext} from '../src/site/types';
import {parseSiteObj} from '../src/site/exchange';
import {assignDesignLayer,createDesignLayer,updateDesignLayer} from '../src/domain/designWorkbench';
import SiteWorkspace from '../src/components/SiteWorkspace';
const source='v 0 0 0\nv 2 0 0\nv 2 2 1\nf 1 2 3\n';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function file(text:()=>Promise<string>){const result=new File(['fixture'],'Survey.obj',{type:'text/plain'});Object.defineProperty(result,'text',{value:text});return result;}
describe('Site workspace review, source fidelity and geographic analysis',()=>{
 it('stages location and north changes, synchronises planning north only on explicit acceptance',()=>{
  const project=createBlankProject('Survey site');project.planning={...emptyPlanningContext(),northAngle:25};const before=structuredClone(project),commit=vi.fn();
  render(<SiteWorkspace project={project} canEdit onCommit={commit}/>);fireEvent.click(screen.getByRole('tab',{name:'Location & survey'}));
  expect((screen.getByLabelText('True north · degrees counter-clockwise from model +Y')as HTMLInputElement).value).toBe('25');
  fireEvent.change(screen.getByLabelText('Latitude · north positive'),{target:{value:'10'}});fireEvent.change(screen.getByLabelText('Longitude · east positive'),{target:{value:'76'}});fireEvent.change(screen.getByLabelText('True north · degrees counter-clockwise from model +Y'),{target:{value:'60'}});
  expect(commit).not.toHaveBeenCalled();expect(project).toEqual(before);fireEvent.click(screen.getByRole('button',{name:'Accept site changes'}));
  expect(commit).toHaveBeenCalledTimes(1);expect(commit.mock.calls[0][0].site.latitude).toBe(10);expect(commit.mock.calls[0][0].site.trueNorthAngle).toBe(60);expect(commit.mock.calls[0][0].planning.northAngle).toBe(60);expect(project).toEqual(before);
 });
 it('keeps stale site previews visible but cannot accept them',()=>{
  const project=createBlankProject('Stale site'),commit=vi.fn(),view=render(<SiteWorkspace project={project} canEdit onCommit={commit}/>);fireEvent.click(screen.getByRole('tab',{name:'Location & survey'}));
  fireEvent.change(screen.getByLabelText('Coordinate / survey provenance'),{target:{value:'Surveyor record'}});
  view.rerender(<SiteWorkspace project={{...project,version:project.version+1}} canEdit onCommit={commit}/>);
  expect(screen.getByRole('alert').textContent).toContain('project changed');expect((screen.getByRole('button',{name:'Accept site changes'})as HTMLButtonElement).disabled).toBe(true);expect(commit).not.toHaveBeenCalled();
 });
 it('previews imported source geometry and placement before accepting it',async()=>{
  const project=createBlankProject('Placed context'),before=structuredClone(project),commit=vi.fn();render(<SiteWorkspace project={project} canEdit onCommit={commit}/>);
  fireEvent.click(screen.getByRole('tab',{name:'Reference context'}));fireEvent.change(screen.getByLabelText('Import site reference file'),{target:{files:[file(async()=>source)]}});
  await screen.findByRole('heading',{name:'Survey.obj'});expect(screen.getByRole('img',{name:'Site context and calculated sun screening plan'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Survey.obj origin X · m'),{target:{value:'10'}});fireEvent.change(screen.getByLabelText('Survey.obj rotation · degrees'),{target:{value:'90'}});
  expect(screen.getByRole('img',{name:'Site context and calculated sun screening plan'}).querySelector('polygon')?.getAttribute('points')).toBe('10,0 10,2 8,2');
  expect(commit).not.toHaveBeenCalled();expect(project).toEqual(before);fireEvent.click(screen.getByRole('button',{name:'Accept site changes'}));
  const next=commit.mock.calls[0][0];expect(next.site.contexts[0].placement.origin.x).toBe(10);expect(next.site.contexts[0].placement.rotation).toBe(90);expect(next.site.contexts[0].vertices[0].x).toBe(0);expect(next.elements).toEqual(project.elements);
 });
 it('rejects an asynchronous file result when the project changes while reading it',async()=>{
  let finish!:(text:string)=>void;const pending=new Promise<string>(resolve=>{finish=resolve;}),project=createBlankProject('Import race'),commit=vi.fn();
  const view=render(<SiteWorkspace project={project} canEdit onCommit={commit}/>);fireEvent.click(screen.getByRole('tab',{name:'Reference context'}));fireEvent.change(screen.getByLabelText('Import site reference file'),{target:{files:[file(()=>pending)]}});
  view.rerender(<SiteWorkspace project={{...project,description:'Changed during file read'}} canEdit onCommit={commit}/>);
  await act(async()=>{finish(source);await pending;});await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('project changed during import'));
  expect(screen.queryByRole('heading',{name:'Survey.obj'})).toBeNull();expect(commit).not.toHaveBeenCalled();
 });
 it('calculates actual exterior-point sun hours and marks the report stale after receiver changes',()=>{
  const project=createBlankProject('Sun report');project.site={...emptySiteContext(),latitude:0,longitude:0,utcOffsetHours:0};render(<SiteWorkspace project={project} canEdit={false} onCommit={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Analysis date'),{target:{value:'2026-03-20'}});fireEvent.click(screen.getByRole('button',{name:'Calculate direct sun hours'}));
  const results=screen.getByRole('region',{name:'Direct sun hours results'});expect(within(results).getByText(/48 midpoint samples/)).toBeTruthy();expect(within(results).getAllByRole('row')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Receiver X · m'),{target:{value:'4'}});expect(within(results).getByText(/Inputs changed/)).toBeTruthy();
 });
 it('keeps reference and location authoring read-only while retaining inspection controls',()=>{
  const project=createBlankProject('Read-only site');render(<SiteWorkspace project={project} canEdit={false} onCommit={vi.fn()}/>);
  fireEvent.click(screen.getByRole('tab',{name:'Reference context'}));expect((screen.getByRole('button',{name:'Import context'})as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('tab',{name:'Location & survey'}));expect((screen.getByLabelText('Latitude · north positive')as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('tab',{name:'Sun & site'}));expect((screen.getByLabelText('Analysis date')as HTMLInputElement).disabled).toBe(false);
 });
 it('recovers the calculate action after synchronous worker startup or message failure',()=>{
  const project=createBlankProject('Worker failure');project.site={...emptySiteContext(),latitude:0,longitude:0,utcOffsetHours:0};
  vi.stubGlobal('Worker',class {constructor(){throw new Error('Worker blocked');}});
  const view=render(<SiteWorkspace project={project} canEdit={false} onCommit={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Calculate direct sun hours'}));
  expect(screen.getByRole('alert').textContent).toContain('could not start');expect((screen.getByRole('button',{name:'Calculate direct sun hours'})as HTMLButtonElement).disabled).toBe(false);view.unmount();
  const terminate=vi.fn();vi.stubGlobal('Worker',class {terminate=terminate;postMessage(){throw new Error('Data clone failed');}});
  render(<SiteWorkspace project={project} canEdit={false} onCommit={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Calculate direct sun hours'}));
  expect(screen.getByRole('alert').textContent).toContain('could not start');expect(terminate).toHaveBeenCalledTimes(1);expect((screen.getByRole('button',{name:'Calculate direct sun hours'})as HTMLButtonElement).disabled).toBe(false);
 });
 it('retains the detached site proposal when a protected context layer rejects acceptance',()=>{
  let project=createBlankProject('Protected reference');const asset=parseSiteObj(source,'Protected.obj');project.site={...emptySiteContext(),contexts:[asset]};project=createDesignLayer(project,'Survey source','context','admin');const layerId=project.workbench!.layers[0].id;project=assignDesignLayer(project,layerId,[asset.id],'admin');project=updateDesignLayer(project,layerId,{locked:true},'admin');const commit=vi.fn();
  render(<SiteWorkspace project={project} canEdit onCommit={commit}/>);fireEvent.click(screen.getByRole('tab',{name:'Reference context'}));fireEvent.change(screen.getByLabelText('Protected.obj origin X · m'),{target:{value:'10'}});fireEvent.click(screen.getByRole('button',{name:'Accept site changes'}));
  expect(screen.getByRole('alert').textContent).toContain('layer Survey source is locked');expect(screen.getByRole('region',{name:'Site changes preview'})).toBeTruthy();expect((screen.getByLabelText('Protected.obj origin X · m')as HTMLInputElement).value).toBe('10');expect(commit).not.toHaveBeenCalled();
 });
});
