// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {createBlankProject} from '../src/domain/seed';
import PlanningPanel from '../src/components/PlanningPanel';
import {emptyPlanningContext} from '../src/domain/planning';
import {keralaResidentialWorksheet} from '../src/domain/keralaRules';
afterEach(cleanup);
describe('Site configuration and honest review UI',()=>{
 it('keeps old models untouched until save and offers Kerala/body selectors with dated sources',()=>{
  const project=createBlankProject('Planning UI'),before=structuredClone(project),commit=vi.fn();render(<PlanningPanel project={project} role="admin" commit={commit} onSelect={vi.fn()}/>);
  expect(screen.getAllByText('Not evaluated').length).toBe(8);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));
  const dialog=screen.getByRole('dialog');expect((within(dialog).getByLabelText('State / region')as HTMLSelectElement).value).toBe('Kerala');
  fireEvent.change(within(dialog).getByLabelText('Local-body type'),{target:{value:'corporation'}});fireEvent.change(within(dialog).getByLabelText('City / local authority'),{target:{value:'Kochi Municipal Corporation'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Load dated Kerala A1 worksheet'}));expect((within(dialog).getByLabelText('Rule version / amendment')as HTMLInputElement).value).toContain('53/2025');expect((within(dialog).getByLabelText(/I have checked subsequent amendments/)as HTMLInputElement).checked).toBe(false);expect(commit).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button',{name:'Save site review inputs'}));expect(commit).toHaveBeenCalledTimes(1);expect(commit.mock.calls[0][0].planning.authorityType).toBe('corporation');expect(commit.mock.calls[0][0].planning.ruleSource.confirmedBy).toBe('');expect(project).toEqual(before);
 });
 it('prevents empty directional profiles from being saved and cancel leaves no changes',()=>{
  const commit=vi.fn();render(<PlanningPanel project={createBlankProject('Preferences')} role="editor" commit={commit} onSelect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));const dialog=screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByLabelText('Evaluate selected directional preferences'));fireEvent.click(within(dialog).getByRole('button',{name:'Add directional preference'}));fireEvent.click(within(dialog).getByRole('button',{name:'Save site review inputs'}));expect(commit).not.toHaveBeenCalled();expect(within(dialog).getByRole('alert')).toBeTruthy();
  fireEvent.click(within(dialog).getByLabelText('SE'));fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));expect(commit).not.toHaveBeenCalled();
 });
 it('keeps reviewer and contributor configuration read-only',()=>{
  for(const role of ['reviewer','contributor']as const){const view=render(<PlanningPanel project={createBlankProject(role)} role={role} commit={vi.fn()} onSelect={vi.fn()}/>);expect((screen.getByRole('button',{name:'Configure site & rules'})as HTMLButtonElement).disabled).toBe(true);view.unmount();}
 });
 it('allows a dated worksheet to become a custom source only with renewed approval',()=>{
  const project=createBlankProject('Manual source transition');project.planning=keralaResidentialWorksheet({...emptyPlanningContext(),authority:'QA municipality',authorityType:'municipality'});Object.assign(project.planning.ruleSource,{amendmentsChecked:true,confirmedBy:'Prior reviewer',reviewedOn:'2026-10-24'});
  const before=structuredClone(project),commit=vi.fn();render(<PlanningPanel project={project} role="admin" commit={commit} onSelect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Configure site & rules'}));const dialog=screen.getByRole('dialog');
  expect((within(dialog).getByLabelText(/I have checked subsequent amendments/)as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole('button',{name:'Use a new manually reviewed source'}));fireEvent.change(within(dialog).getByLabelText('Rule version / amendment'),{target:{value:'Synthetic new source version'}});
  expect((within(dialog).getByLabelText(/I have checked subsequent amendments/)as HTMLInputElement).checked).toBe(false);fireEvent.click(within(dialog).getByRole('button',{name:'Save site review inputs'}));
  expect(commit).toHaveBeenCalledTimes(1);const saved=commit.mock.calls[0][0].planning;expect(saved.ruleSource.worksheet).toBeUndefined();expect(saved.ruleSource.amendmentsChecked).toBe(false);expect(saved.rules).toEqual(project.planning.rules);expect(saved.ruleSource.version).toBe('Synthetic new source version');expect(project).toEqual(before);
 });
});
