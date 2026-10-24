// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import SchedulePanel from '../src/components/SchedulePanel';
import {createDemoProject} from '../src/domain/seed';
import {buildSchedule,generateActivities} from '../src/engine/schedule';
import {invalidateScheduleReview} from '../src/engine/modelImpact';
import type {Project,Role} from '../src/domain/types';

afterEach(cleanup);
function fixture(){const before=createDemoProject();before.schedule.activities=generateActivities(before);const after=structuredClone(before);after.elements.push({...after.elements.find(e=>e.kind==='wall')!,id:'new-wall-review',x:30});return invalidateScheduleReview(before,after);}
function mount(project=fixture(),role:Role='editor'){const commit=vi.fn(),view=render(<SchedulePanel project={project} role={role} commit={commit} schedule={buildSchedule(project)} onExport={vi.fn()}/>);return{commit,view,project};}

describe('explicit construction scope review',()=>{
  it('shows unresolved dates instead of zero-day claims and requires explicit review before one atomic commit',()=>{
    const {project,commit}=mount(),before=JSON.stringify(project);
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);expect(screen.getAllByText('Unresolved')).toHaveLength(2);expect(screen.queryByText('0 days')).toBeNull();
    expect(screen.getByText('Critical activities').closest('.metric')?.textContent).toContain('Unresolved');
    expect(screen.getByText('Construction timeline unresolved')).toBeTruthy();expect(screen.queryAllByText(/^Day \d+$/)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:'Review model quantities'}));
    const dialog=screen.getByRole('dialog',{name:'Review model quantities & activity scope'});
    expect(dialog.textContent).toContain('new-wall-review');expect(dialog.textContent).toMatch(/Manual quantity retained exactly/);expect(dialog.textContent).toMatch(/unmodelled work/i);
    expect(commit).not.toHaveBeenCalled();expect(JSON.stringify(project)).toBe(before);
    fireEvent.click(within(dialog).getByRole('button',{name:'Accept reviewed activity scope'}));
    expect(commit).toHaveBeenCalledTimes(1);expect(screen.queryByRole('dialog')).toBeNull();
    const next=commit.mock.calls[0][0] as Project;expect(next.schedule.modelReviewRequired).toBe(false);expect(next.schedule.modelReview?.acceptedAt).toBeTruthy();expect(buildSchedule(next).feasible).toBe(true);expect(JSON.stringify(project)).toBe(before);
  });
  it('lets reviewers inspect source IDs but disables accepting planner mutations',()=>{
    const {commit}=mount(fixture(),'reviewer');fireEvent.click(screen.getByRole('button',{name:'Review model quantities'}));
    const accept=screen.getByRole('button',{name:'Accept reviewed activity scope'}) as HTMLButtonElement;expect(accept.disabled).toBe(true);fireEvent.click(accept);expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('describes an initial generated network as new preliminary scope rather than stored manual work',()=>{
    const project=fixture();project.schedule.activities=[];mount(project);
    fireEvent.click(screen.getByRole('button',{name:'Review model quantities'}));
    const dialog=screen.getByRole('dialog');expect(dialog.textContent).toMatch(/first preliminary construction template/);expect(dialog.textContent).toMatch(/Preliminary manual\/proxy quantity generated/);expect(dialog.textContent).not.toMatch(/Manual quantity retained exactly/);
    const rows=within(dialog).getAllByRole('row');expect(rows.filter(row=>row.textContent?.includes('Add activity'))).toHaveLength(generateActivities(project).length);
  });
  it('rejects a review if the current project changes before acceptance',()=>{
    const {commit,view,project}=mount();fireEvent.click(screen.getByRole('button',{name:'Review model quantities'}));
    const changed=structuredClone(project);changed.elements[0].width+=2;
    view.rerender(<SchedulePanel project={changed} role="editor" commit={commit} schedule={buildSchedule(changed)} onExport={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Accept reviewed activity scope'}));expect(commit).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toMatch(/changed while/);
  });
  it('provides model source selection and deliberate manual-quantity controls for ambiguous work packages',()=>{
    const {commit}=mount();fireEvent.click(screen.getByRole('button',{name:'Activities & logic'}));
    const ids=screen.getByRole('textbox',{name:'Wall construction source element IDs'});fireEvent.change(ids,{target:{value:'wall-n-00, wall-s-00'}});fireEvent.blur(ids);
    expect(commit).toHaveBeenCalledTimes(1);const next=commit.mock.calls[0][0] as Project;expect(next.schedule.activities.find(a=>a.id==='walls')!.sourceElementIds).toEqual(['wall-n-00','wall-s-00']);
    fireEvent.change(screen.getByRole('combobox',{name:'Wall construction quantity source'}),{target:{value:'manual'}});expect(commit).toHaveBeenCalledTimes(2);expect((commit.mock.calls[1][0] as Project).schedule.activities.find(a=>a.id==='walls')!.quantityMode).toBe('manual');
  });
});
