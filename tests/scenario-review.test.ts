import {describe,expect,it} from 'vitest';
import {createDemoProject} from '../src/domain/seed';
import type {ActivityDefinition,SequenceAlternative} from '../src/domain/types';
import {adoptScenario,compareScenarios,sequenceBaselineSignature} from '../src/engine/scenarios';
import {acceptScheduleRefresh,invalidateScheduleReview,previewScheduleRefresh} from '../src/engine/modelImpact';
import {buildSchedule,scheduleReviewIsCurrent,stampScheduleCandidate} from '../src/engine/schedule';

function fixture(){
  const p=createDemoProject();p.elements=[p.elements.find(e=>e.id==='wall-n-00')!];p.constraints.budget=1e9;p.constraints.deadline='2030-01-01';p.schedule.procurementDays=0;p.schedule.crews=2;
  for(const allowance of p.allowances)if(allowance.amount===null)allowance.amount=1000;
  const task=(id:string,predecessors:string[]=[]):ActivityDefinition=>({id,name:id,category:'wall',quantity:1,unit:'item',productivity:1,minDuration:1,predecessors,crewDemand:1,maxCrews:1,leadTime:0,fixedDuration:2,quantityMode:'manual',productivityMode:'manual'});
  p.schedule.activities=[task('a'),task('b',['a'])];return acceptScheduleRefresh(p,previewScheduleRefresh(p),'editor');
}
function sequence(p:ReturnType<typeof fixture>):SequenceAlternative{return{id:'independent',name:'Independent work fronts',approved:true,rationale:'Planner confirmed independent fixture work fronts',baselineSignature:sequenceBaselineSignature(p),predecessors:{b:[]}};}

describe('reviewed construction scenarios',()=>{
  it('evaluates and explicitly adopts an approved assembly change after model scope review',()=>{
    const p=fixture(),before=JSON.stringify(p),option=compareScenarios(p,'tradeoffs').find(s=>Object.keys(s.typeChanges).length>0)!;
    expect(option).toBeDefined();expect(option.feasible).toBe(true);expect(option.schedule.feasible).toBe(true);
    const adopted=adoptScenario(p,option,'tradeoffs','editor');expect(adopted.elements[0].typeId).toBe(option.typeChanges[p.elements[0].id]);
    expect(scheduleReviewIsCurrent(adopted)).toBe(true);expect(buildSchedule(adopted).feasible).toBe(true);expect(invalidateScheduleReview(p,adopted)).toBe(adopted);expect(JSON.stringify(p)).toBe(before);
  });
  it('evaluates reviewed approved predecessor changes and expires their prior-baseline approval when adopted',()=>{
    const p=fixture();p.schedule.sequenceAlternatives=[sequence(p)];
    const option=compareScenarios(p,'tradeoffs').find(s=>s.sequenceAlternativeId==='independent')!;
    expect(option).toBeDefined();expect(option.schedule.workingDays).toBe(2);expect(option.changes.join(' ')).toMatch(/expires sequence approvals/);
    const adopted=adoptScenario(p,option,'tradeoffs','admin');expect(adopted.schedule.activities.find(a=>a.id==='b')!.predecessors).toEqual([]);
    expect(buildSchedule(adopted).feasible).toBe(true);expect(adopted.schedule.sequenceAlternatives![0].approved).toBe(false);expect(p.schedule.sequenceAlternatives[0].approved).toBe(true);
  });
  it('never uses virtual review stamps to legitimize a stale or explicitly pending original scope',()=>{
    const p=fixture(),option=compareScenarios(p,'tradeoffs').find(s=>Object.keys(s.typeChanges).length>0)!;
    for(const required of [false,true]){
      const stale=structuredClone(p);stale.elements[0].width+=1;stale.schedule.modelReviewRequired=required;
      const forged=structuredClone(stale);forged.schedule.modelReviewRequired=false;
      expect(stampScheduleCandidate(stale,forged).schedule.modelReviewRequired).toBe(true);
      expect(compareScenarios(stale,'tradeoffs').every(s=>!s.feasible)).toBe(true);expect(()=>adoptScenario(stale,option,'tradeoffs','admin')).toThrow(/Review the changed model/);
    }
  });
  it('rechecks worker results, roles, activity approvals, locks and displayed metrics at adoption',()=>{
    const p=fixture(),option=compareScenarios(p,'tradeoffs').find(s=>Object.keys(s.typeChanges).length>0)!;
    expect(()=>adoptScenario(p,option,'tradeoffs','reviewer')).toThrow(/Reviewers/);expect(()=>adoptScenario(p,option,'tradeoffs','contributor')).toThrow(/architect/);
    expect(()=>adoptScenario(p,{...option,cost:{...option.cost,total:1}},'tradeoffs','admin')).toThrow(/displayed cost/);
    const locked=structuredClone(p);locked.constraints.lockedProperties=['material'];expect(()=>adoptScenario(locked,option,'tradeoffs','admin')).toThrow(/no longer satisfies/);
    p.schedule.sequenceAlternatives=[sequence(p)];const sequenced=compareScenarios(p,'tradeoffs').find(s=>s.sequenceAlternativeId)!;p.schedule.sequenceAlternatives[0].approved=false;
    expect(()=>adoptScenario(p,sequenced,'tradeoffs','admin')).toThrow(/no longer satisfies/);
  });
});
