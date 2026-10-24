// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {createBlankProject} from '../src/domain/seed';
import PlanningPanel from '../src/components/PlanningPanel';
import {emptyPlanningContext} from '../src/domain/planning';
import {emptySiteContext} from '../src/site/types';
import {assessPlanning} from '../src/engine/planningChecks';
import {keralaResidentialWorksheet} from '../src/domain/keralaRules';
afterEach(cleanup);
describe('Site configuration and honest review UI',()=>{
 it('keeps old models untouched until save and offers Kerala/body selectors with dated sources',()=>{
  const project=createBlankProject('Planning UI'),before=structuredClone(project),commit=vi.fn();render(<PlanningPanel project={project} role="admin" commit={commit} onSelect={vi.fn()}/>);
  expect(screen.getAllByText('Not evaluated').length).toBe(8);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));
  const dialog=screen.getByRole('dialog');expect((within(dialog).getByLabelText('State / region')as HTMLSelectElement).value).toBe('Kerala');
  fireEvent.change(within(dialog).getByLabelText('Local-body type'),{target:{value:'corporation'}});fireEvent.change(within(dialog).getByLabelText('City / local authority'),{target:{value:'Kochi Municipal Corporation'}});
  fireEvent.click(within(dialog).getByRole('button',{name:/Rules & source/}));fireEvent.click(within(dialog).getByRole('button',{name:'Load dated Kerala A1 worksheet'}));expect((within(dialog).getByLabelText('Rule version / amendment')as HTMLInputElement).value).toContain('53/2025');expect((within(dialog).getByLabelText(/I have checked subsequent amendments/)as HTMLInputElement).checked).toBe(false);expect(commit).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button',{name:'Save site review inputs'}));expect(commit).toHaveBeenCalledTimes(1);expect(commit.mock.calls[0][0].planning.authorityType).toBe('corporation');expect(commit.mock.calls[0][0].planning.ruleSource.confirmedBy).toBe('');expect(project).toEqual(before);
 });
 it('prevents empty directional profiles from being saved and cancel leaves no changes',()=>{
  const commit=vi.fn();render(<PlanningPanel project={createBlankProject('Preferences')} role="editor" commit={commit} onSelect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));const dialog=screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button',{name:/Preferences & notes/}));fireEvent.click(within(dialog).getByText('Vaastu preferences',{selector:'summary',exact:false}));fireEvent.click(within(dialog).getByLabelText('Evaluate selected directional preferences'));fireEvent.click(within(dialog).getByRole('button',{name:'Add directional preference'}));fireEvent.click(within(dialog).getByRole('button',{name:'Save site review inputs'}));expect(commit).not.toHaveBeenCalled();expect(within(dialog).getByRole('alert')).toBeTruthy();
  fireEvent.click(within(dialog).getByLabelText('SE'));fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));expect(commit).not.toHaveBeenCalled();
 });
 it('keeps reviewer and contributor configuration read-only',()=>{
  for(const role of ['reviewer','contributor']as const){const view=render(<PlanningPanel project={createBlankProject(role)} role={role} commit={vi.fn()} onSelect={vi.fn()}/>);expect((screen.getByRole('button',{name:'Configure site & rules'})as HTMLButtonElement).disabled).toBe(true);view.unmount();}
 });
 it('allows a dated worksheet to become a custom source only with renewed approval',()=>{
  const project=createBlankProject('Manual source transition');project.planning=keralaResidentialWorksheet({...emptyPlanningContext(),authority:'QA municipality',authorityType:'municipality'});Object.assign(project.planning.ruleSource,{amendmentsChecked:true,confirmedBy:'Prior reviewer',reviewedOn:'2026-10-24'});
  const before=structuredClone(project),commit=vi.fn();render(<PlanningPanel project={project} role="admin" commit={commit} onSelect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));const dialog=screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button',{name:/Rules & source/}));expect((within(dialog).getByLabelText(/I have checked subsequent amendments/)as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole('button',{name:'Use a new manually reviewed source'}));fireEvent.change(within(dialog).getByLabelText('Rule version / amendment'),{target:{value:'Synthetic new source version'}});
  expect((within(dialog).getByLabelText(/I have checked subsequent amendments/)as HTMLInputElement).checked).toBe(false);fireEvent.click(within(dialog).getByRole('button',{name:'Save site review inputs'}));
  expect(commit).toHaveBeenCalledTimes(1);const saved=commit.mock.calls[0][0].planning;expect(saved.ruleSource.worksheet).toBeUndefined();expect(saved.ruleSource.amendmentsChecked).toBe(false);expect(saved.rules).toEqual(project.planning.rules);expect(saved.ruleSource.version).toBe('Synthetic new source version');expect(project).toEqual(before);
 });
 it('shows essentials first, focuses the next missing field and preserves the draft while moving between steps',()=>{
  const project=createBlankProject('Progressive setup'),commit=vi.fn();render(<PlanningPanel project={project} role="admin" commit={commit} onSelect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));const dialog=screen.getByRole('dialog');
  expect(within(dialog).getByRole('region',{name:'Site essentials'})).toBeTruthy();expect(within(dialog).queryByRole('region',{name:'Rules and source review'})).toBeNull();expect(within(dialog).queryByRole('button',{name:'Load dated Kerala A1 worksheet'})).toBeNull();
  expect(within(dialog).getByText('Required for building-rule comparisons:')).toBeTruthy();expect(within(dialog).getByText('Required for setbacks, coverage and floor-area ratio:')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button',{name:'Go to field'}));expect(document.activeElement).toBe(within(dialog).getByLabelText('Local-body type'));
  fireEvent.change(within(dialog).getByLabelText('City / local authority'),{target:{value:'Draft authority'}});fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));expect(within(dialog).getByRole('region',{name:'Rules and source review'})).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button',{name:/Preferences & notes/}));expect(within(dialog).getByText(/These inputs are optional/)).toBeTruthy();const vaastu=within(dialog).getByText('Vaastu preferences',{selector:'summary',exact:false}).closest('details');expect(vaastu?.open).toBe(false);
  fireEvent.click(within(dialog).getByRole('button',{name:/Site essentials/}));expect((within(dialog).getByLabelText('City / local authority')as HTMLInputElement).value).toBe('Draft authority');expect(commit).not.toHaveBeenCalled();
 });
 it('saves partial setup as unknown without approving a source or inventing limits',()=>{
  const project=createBlankProject('Partial setup'),commit=vi.fn();render(<PlanningPanel project={project} role="admin" commit={commit} onSelect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));fireEvent.click(screen.getByRole('button',{name:'Save site review inputs'}));
  const saved=commit.mock.calls[0][0];expect(saved.planning).toMatchObject({plot:null,groundElevation:null,northAngle:null,rules:[],ruleSource:{amendmentsChecked:false,confirmedBy:''},vaastu:{enabled:false,preferences:[]}});expect(assessPlanning(saved).checks.every(check=>check.status==='not-evaluated')).toBe(true);expect(project.planning).toBeUndefined();
 });
 it('offers an explicit discard decision and keeps draft values when close is cancelled',()=>{
  const project=createBlankProject('Discard draft'),before=structuredClone(project),commit=vi.fn();render(<PlanningPanel project={project} role="editor" commit={commit} onSelect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));fireEvent.change(screen.getByLabelText('City / local authority'),{target:{value:'Unsaved authority'}});fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));
  expect(screen.getByRole('alert').textContent).toContain('Discard unsaved site inputs?');fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));expect((screen.getByLabelText('City / local authority')as HTMLInputElement).value).toBe('Unsaved authority');fireEvent.click(screen.getByRole('button',{name:'Cancel'}));fireEvent.click(screen.getByRole('button',{name:'Discard changes'}));expect(screen.queryByRole('dialog')).toBeNull();expect(project).toEqual(before);expect(commit).not.toHaveBeenCalled();
 });
 it('reuses explicit Site orientation for a new setup but keeps datum and plot unconfirmed',()=>{
  const project=createBlankProject('Site anchor');project.site={...emptySiteContext(),latitude:9.93,longitude:76.26,trueNorthAngle:32,datumElevation:140,source:'Survey reference'};const before=structuredClone(project),commit=vi.fn();render(<PlanningPanel project={project} role="admin" commit={commit} onSelect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));
  expect(screen.getByText(/Map anchor: 9.93°/)).toBeTruthy();expect((screen.getByLabelText(/True north angle/)as HTMLInputElement).value).toBe('32');expect((screen.getByLabelText('Survey ground elevation · model Z metres')as HTMLInputElement).value).toBe('');fireEvent.click(screen.getByRole('button',{name:'Save site review inputs'}));expect(commit.mock.calls[0][0].planning).toMatchObject({northAngle:32,groundElevation:null,plot:null});expect(project).toEqual(before);
 });
 it('retains an existing explicit unknown north rather than replacing it from Site context',()=>{
  const project=createBlankProject('Unknown north');project.site={...emptySiteContext(),trueNorthAngle:45};project.planning=emptyPlanningContext();const commit=vi.fn();render(<PlanningPanel project={project} role="admin" commit={commit} onSelect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));fireEvent.click(screen.getByRole('button',{name:'Save site review inputs'}));expect(commit.mock.calls[0][0].planning.northAngle).toBeNull();
 });

});
