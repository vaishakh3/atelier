// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {createBlankProject,createDemoProject} from '../src/domain/seed';
import type {Project} from '../src/domain/types';
import ServicesPanel from '../src/components/ServicesPanel';
import {createServicePlan} from '../src/services/model';

afterEach(cleanup);
function house(withServices=true):Project{
 const project=createDemoProject();
 const uses:Record<string,string>={'room-living':'living','room-kitchen':'kitchen','room-study':'study','room-service':'utility','room-bed1':'bedroom','room-bed2':'bedroom','room-bed3':'utility','room-landing':'bathroom'};
 project.elements=project.elements.map(element=>element.kind==='room'?{...element,properties:{...element.properties,use:uses[element.id]}}:element);
 if(withServices)project.services=createServicePlan(project);
 return project;
}

describe('Services workspace proposal and connected change review',()=>{
 it('previews generation, leaves the source unchanged and saves only on explicit acceptance',()=>{
  const project=house(false),before=structuredClone(project),commit=vi.fn();
  render(<ServicesPanel project={project} role="editor" onCommit={commit}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Propose services'})[0]);
  expect(screen.getByRole('region',{name:'Services change preview'})).toBeTruthy();
  expect(screen.getByRole('img',{name:'Ground floor services coordination plan'})).toBeTruthy();
  expect(commit).not.toHaveBeenCalled();expect(project).toEqual(before);
  fireEvent.click(screen.getByRole('button',{name:'Accept services proposal'}));
  expect(commit).toHaveBeenCalledTimes(1);expect(commit.mock.calls[0][0].services.points.length).toBeGreaterThan(10);expect(commit.mock.calls[0][0].elements).toEqual(project.elements);expect(project).toEqual(before);
 });

 it('keeps unknown rates visible, requires a deliberate demo-rate action and applies no hidden market figures',()=>{
  const project=house(),before=structuredClone(project),commit=vi.fn();
  render(<ServicesPanel project={project} role="admin" onCommit={commit}/>);
  fireEvent.click(screen.getByRole('tab',{name:'Quantities & estimates'}));
  expect((screen.getByLabelText('Light point material rate')as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button',{name:'Use illustrative demo rates'}));
  expect(screen.getByRole('region',{name:'Services change preview'})).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Entered illustrative demo service rates and productivity'}));
  expect((screen.getByLabelText('Light point material rate')as HTMLInputElement).value).toBe('650');
  expect((screen.getByLabelText('Rate source')as HTMLInputElement).value).toContain('not a supplier quote');
  expect(commit).not.toHaveBeenCalled();expect(project).toEqual(before);
  fireEvent.click(screen.getByRole('button',{name:'Discard proposal'}));
  expect((screen.getByLabelText('Light point material rate')as HTMLInputElement).value).toBe('');expect(commit).not.toHaveBeenCalled();
 });

 it('keeps point edits and bathroom relocation reviewable with changed connections and quantities',()=>{
  const project=house(),before=structuredClone(project),commit=vi.fn(),select=vi.fn();
  render(<ServicesPanel project={project} role="admin" onCommit={commit} onSelect={select}/>);
  const point=project.services!.points.find(point=>point.kind==='light')!;
  fireEvent.click(screen.getByRole('button',{name:`${point.name} · ${point.kind}`}));
  expect(select).not.toHaveBeenCalled();
  screen.getByLabelText('Connected load · W').focus();
  fireEvent.change(screen.getByLabelText('Connected load · W'),{target:{value:'18'}});
  expect(document.activeElement).toBe(screen.getByLabelText('Connected load · W'));
  expect(screen.getByRole('region',{name:'Services change preview'})).toBeTruthy();expect(project).toEqual(before);
  fireEvent.click(screen.getByRole('button',{name:'Discard proposal'}));
  fireEvent.change(screen.getByLabelText('Swap room function with'),{target:{value:'room-bed3'}});
  fireEvent.click(screen.getByRole('button',{name:'Review bathroom relocation'}));
  const review=screen.getByRole('region',{name:'Services change preview'});
  expect(within(review).getByText('Changed connections')).toBeTruthy();
  expect(within(review).getByText('Route lengths · before → proposal')).toBeTruthy();
  expect(within(review).getByText(/Inspect \d+ affected connections/)).toBeTruthy();
  expect((screen.getByRole('button',{name:'Review bathroom relocation'})as HTMLButtonElement).disabled).toBe(true);
  expect(commit).not.toHaveBeenCalled();expect(project).toEqual(before);
  fireEvent.click(screen.getByRole('button',{name:'Accept services proposal'}));
  expect(commit).toHaveBeenCalledTimes(1);
  const accepted=commit.mock.calls[0][0]as Project;
  expect(accepted.elements.find(element=>element.id==='room-bed3')!.properties.use).toBe('bathroom');
  expect(accepted.elements.find(element=>element.id==='room-bed3')!.width).toBe(project.elements.find(element=>element.id==='room-bed3')!.width);
 });

 it('blocks stale preview acceptance on a full project snapshot, including changes without a version bump',()=>{
  const project=house(),commit=vi.fn(),view=render(<ServicesPanel project={project} role="admin" onCommit={commit}/>);
  fireEvent.click(screen.getByRole('button',{name:'Review bathroom relocation'}));
  view.rerender(<ServicesPanel project={{...project,description:'Changed by another interaction'}} role="admin" onCommit={commit}/>);
  expect(screen.getByRole('alert').textContent).toContain('project changed');
  expect((screen.getByRole('button',{name:'Accept services proposal'})as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Accept services proposal'}));expect(commit).not.toHaveBeenCalled();
 });

 it('supports level and layer changes, and exposes calculation assumptions without engineering claims',()=>{
  render(<ServicesPanel project={house()} role="reviewer" onCommit={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Plan level'),{target:{value:'level-1'}});
  expect(screen.getByRole('img',{name:'First floor services coordination plan'})).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Electrical'));
  expect((screen.getByLabelText('Electrical')as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('button',{name:'Review bathroom relocation'})as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('tab',{name:'Calculation notebook'}));
  expect(screen.getByLabelText('Demand factor')).toBeTruthy();
  expect(screen.getByText('Screening current')).toBeTruthy();
  expect(screen.getByText(/does not size cables/)).toBeTruthy();
  expect(screen.getByRole('link',{name:'Formula reference · electrical power'})).toBeTruthy();
  expect((screen.getByLabelText('Supply voltage · V')as HTMLInputElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('tab',{name:'Calculation notebook'}),{key:'Home'});
  expect(screen.getByRole('tab',{name:'Coordinate'}).getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('tab',{name:'Coordinate'}));
 });

 it('reports unsupported unclassified-room generation as an actionable error without making a project',()=>{
  const commit=vi.fn();render(<ServicesPanel project={createDemoProject()} role="admin" onCommit={commit}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Propose services'})[0]);
  expect(screen.getByRole('alert').textContent).toContain('Assign explicit room uses');expect(commit).not.toHaveBeenCalled();
 });

 it('offers the connected demonstration only in an empty project and leaves it detached on discard',()=>{
  const project=createBlankProject('Demo'),before=structuredClone(project),commit=vi.fn();
  render(<ServicesPanel project={project} role="admin" onCommit={commit}/>);
  fireEvent.click(screen.getByRole('button',{name:'Preview connected demo house'}));
  expect(screen.getByRole('region',{name:'Services change preview'})).toBeTruthy();
  expect((screen.getByLabelText('Plan level')as HTMLSelectElement).options.length).toBe(2);
  expect(commit).not.toHaveBeenCalled();expect(project).toEqual(before);
  fireEvent.click(screen.getByRole('button',{name:'Discard proposal'}));
  expect(screen.getByRole('button',{name:'Preview connected demo house'})).toBeTruthy();expect(project).toEqual(before);
 });

 it('accepts the exact connected house demo before enabling point or rate edits',()=>{
  const project=createBlankProject('Connected example'),commit=vi.fn();
  render(<ServicesPanel project={project} role="admin" onCommit={commit}/>);
  fireEvent.click(screen.getByRole('button',{name:'Preview connected demo house'}));
  expect((screen.getByRole('button',{name:'Review bathroom relocation'})as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Host room')as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('tab',{name:'Quantities & estimates'}));
  expect((screen.getByRole('button',{name:'Use illustrative demo rates'})as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Accept services proposal'}));
  expect(commit).toHaveBeenCalledTimes(1);
  const accepted=commit.mock.calls[0][0]as Project;
  expect(accepted.elements.filter(element=>element.kind==='room'&&element.properties.use==='bedroom')).toHaveLength(4);
  expect(accepted.levels).toHaveLength(2);expect(accepted.services!.assumptions.rates.every(rate=>rate.material===null)).toBe(true);
  expect(accepted.allowances.find(allowance=>allowance.id==='a-mep')!.included).toBe(false);expect(project.elements).toHaveLength(0);
 });

 it('shows stale measurements as requiring review rather than as zero-length current routes',()=>{
  const project=house();project.elements[0]={...project.elements[0],name:'Changed architectural slab'};
  render(<ServicesPanel project={project} role="admin" onCommit={vi.fn()}/>);
  expect(screen.getByText('The model has changed')).toBeTruthy();
  expect(screen.getAllByText('Review required').length).toBeGreaterThan(0);
  expect(screen.queryByText('0 m')).toBeNull();
 });

 it('respects module and host-room locks in the actual editing controls',()=>{
  const project=house(),commit=vi.fn();project.constraints.lockedProperties=['services'];
  const view=render(<ServicesPanel project={project} role="admin" onCommit={commit}/>);
  expect((screen.getByRole('button',{name:'Review & reroute'})as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button',{name:'Review bathroom relocation'})as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('tab',{name:'Quantities & estimates'}));
  expect((screen.getByLabelText('Light point material rate')as HTMLInputElement).disabled).toBe(true);
  view.unmount();project.constraints.lockedProperties=[];
  const point=project.services!.points.find(point=>point.kind==='light')!;project.constraints.lockedElementIds=[point.roomId!];
  render(<ServicesPanel project={project} role="admin" onCommit={commit}/>);
  fireEvent.change(screen.getByLabelText('Service point'),{target:{value:point.id}});
  expect((screen.getByLabelText('Connected load · W')as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('Point host room')as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Connected load · W'),{target:{value:'30'}});
  expect(screen.queryByRole('region',{name:'Services change preview'})).toBeNull();expect(commit).not.toHaveBeenCalled();
 });

 it('uses one keyboard marker stop, correct layer visibility and restores focus after discarding',()=>{
  const project=house();render(<ServicesPanel project={project} role="admin" onCommit={vi.fn()}/>);
  const svg=screen.getByRole('img',{name:'Ground floor services coordination plan'});
  expect(svg.querySelectorAll('[data-service-point][tabindex="0"]').length).toBe(1);
  const marker=svg.querySelector('[data-service-point][tabindex="0"]')as SVGGElement;
  fireEvent.keyDown(marker,{key:'ArrowRight'});
  expect(document.activeElement).not.toBe(marker);
  expect(svg.querySelectorAll('[data-service-point][tabindex="0"]').length).toBe(1);
  const inlet=project.services!.points.find(point=>point.kind==='water-inlet')!,outlet=project.services!.points.find(point=>point.kind==='drain-outlet')!;
  fireEvent.click(screen.getByLabelText('Water'));
  expect(screen.queryByRole('button',{name:`${inlet.name} · ${inlet.kind}`})).toBeNull();
  expect(screen.getByRole('button',{name:`${outlet.name} · ${outlet.kind}`})).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'Quantities & estimates'}));
  fireEvent.click(screen.getByRole('button',{name:'Use illustrative demo rates'}));
  fireEvent.click(screen.getByRole('button',{name:'Discard proposal'}));
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Review & reroute'}));
 });

 it('maps accepted service references to model hosts and keeps source navigation from losing an open proposal',()=>{
  const project=house(),select=vi.fn();render(<ServicesPanel project={project} role="admin" onCommit={vi.fn()} onSelect={select}/>);
  const sourceButton=screen.getAllByRole('button',{name:'View source'}).find(button=>!button.hasAttribute('disabled'))!;
  fireEvent.click(sourceButton);expect(select).toHaveBeenCalledTimes(1);
  expect(select.mock.calls[0][0].every((id:string)=>project.elements.some(element=>element.id===id))).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Review bathroom relocation'}));
  expect(screen.getAllByRole('button',{name:'View source'}).every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
 });
});
