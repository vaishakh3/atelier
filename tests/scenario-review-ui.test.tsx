// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import ScenariosPanel from '../src/components/ScenariosPanel';
import SequenceAlternatives from '../src/components/SequenceAlternatives';
import {createDemoProject} from '../src/domain/seed';
import type {ActivityDefinition,Objective,Project} from '../src/domain/types';
import {buildSchedule,scheduleReviewIsCurrent} from '../src/engine/schedule';
import {estimate} from '../src/engine/cost';
import {compareScenarios} from '../src/engine/scenarios';
import {acceptScheduleRefresh,invalidateScheduleReview,previewScheduleRefresh} from '../src/engine/modelImpact';

vi.mock('../src/domain/usage',()=>({recordUsage:vi.fn()}));
class ScenarioWorker {
  onmessage:((event:{data:{results:ReturnType<typeof compareScenarios>}})=>void)|null=null;
  onerror:(()=>void)|null=null;
  stopped=false;
  terminate(){this.stopped=true;}
  postMessage({project,objective}:{project:Project;objective:Objective}){queueMicrotask(()=>{if(!this.stopped)this.onmessage?.({data:{results:compareScenarios(project,objective)}});});}
}
beforeEach(()=>vi.stubGlobal('Worker',ScenarioWorker));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function fixture(){
  const p=createDemoProject();p.elements=[p.elements.find(e=>e.id==='wall-n-00')!];p.constraints.budget=1e9;p.constraints.deadline='2030-01-01';p.schedule.procurementDays=0;p.schedule.crews=2;
  for(const allowance of p.allowances)if(allowance.amount===null)allowance.amount=1000;
  const task=(id:string,predecessors:string[]=[]):ActivityDefinition=>({id,name:id,category:'wall',quantity:1,unit:'item',productivity:1,minDuration:1,predecessors,crewDemand:1,maxCrews:1,leadTime:0,fixedDuration:2,quantityMode:'manual',productivityMode:'manual'});
  p.schedule.activities=[task('a'),task('b',['a'])];return acceptScheduleRefresh(p,previewScheduleRefresh(p),'editor');
}
function props(project:Project){const schedule=buildSchedule(project);return{project,schedule,cost:estimate(project,schedule),role:'editor' as const,commit:vi.fn(),onExport:vi.fn()};}

describe('reviewed scenario and sequence UI',()=>{
  it('adopts an available reviewed option with a current scope stamp in one commit',async()=>{
    const project=fixture(),base=props(project);render(<ScenariosPanel {...base}/>);fireEvent.click(screen.getByRole('button',{name:'Compare scenarios'}));
    await waitFor(()=>expect((screen.getByRole('button',{name:'Adopt scenario'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'Adopt scenario'}));expect(base.commit).toHaveBeenCalledTimes(1);
    const adopted=base.commit.mock.calls[0][0] as Project;expect(scheduleReviewIsCurrent(adopted)).toBe(true);expect(invalidateScheduleReview(project,adopted)).toBe(adopted);expect(buildSchedule(adopted).feasible).toBe(true);
  });
  it('shows unresolved stale dates and keeps infeasible zero-day results out of the chart and adoption',async()=>{
    const project=fixture();project.elements[0].width+=1;project.schedule.modelReviewRequired=true;
    const base=props(project);render(<ScenariosPanel {...base}/>);expect(screen.getByText('Unresolved')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Compare scenarios'}));
    await screen.findByRole('button',{name:'Adopt scenario'});expect((screen.getByRole('button',{name:'Adopt scenario'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('img',{name:'Scenario cost versus construction duration'})).toBeNull();expect(screen.queryByText('0 days')).toBeNull();expect(base.commit).not.toHaveBeenCalled();
  });
  it('reconciles approved sequence previews with the valid original scope without blocking approval',()=>{
    const project=fixture(),commit=vi.fn();render(<SequenceAlternatives project={project} role="editor" commit={commit}/>);
    fireEvent.click(screen.getByRole('button',{name:'New sequence'}));fireEvent.change(screen.getByRole('textbox',{name:'Sequence name'}),{target:{value:'Independent work fronts'}});
    fireEvent.change(screen.getByRole('textbox',{name:'Sequence rationale'}),{target:{value:'Planner confirmed independent fixture tasks.'}});
    const predecessors=screen.getByRole('textbox',{name:'b alternative predecessors'});fireEvent.change(predecessors,{target:{value:''}});fireEvent.blur(predecessors);
    expect(screen.getByText(/Sequence-only preview: 2 calendar days/)).toBeTruthy();expect((screen.getByRole('button',{name:'Approve sequence'}) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Approve sequence'}));expect(commit).toHaveBeenCalledTimes(1);expect((commit.mock.calls[0][0] as Project).schedule.sequenceAlternatives![0].approved).toBe(true);
  });
  it('cannot approve a sequence while the original model scope has become stale',()=>{
    const project=fixture();project.elements[0].width+=1;const commit=vi.fn();render(<SequenceAlternatives project={project} role="editor" commit={commit}/>);
    fireEvent.click(screen.getByRole('button',{name:'New sequence'}));fireEvent.change(screen.getByRole('textbox',{name:'Sequence name'}),{target:{value:'Independent work fronts'}});
    fireEvent.change(screen.getByRole('textbox',{name:'Sequence rationale'}),{target:{value:'Planner confirmed independent fixture tasks.'}});
    const predecessors=screen.getByRole('textbox',{name:'b alternative predecessors'});fireEvent.change(predecessors,{target:{value:''}});fireEvent.blur(predecessors);
    expect((screen.getByRole('button',{name:'Approve sequence'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByText(/Sequence-only preview: 0/)).toBeNull();expect(commit).not.toHaveBeenCalled();
  });
});
