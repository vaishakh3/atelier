import {describe,expect,it} from 'vitest';
import {createDemoProject} from '../src/domain/seed';
import type {ActivityDefinition,SequenceAlternative} from '../src/domain/types';
import {projectSchema} from '../src/domain/schema';
import {compareScenarios,previewSequenceAlternative,sequenceBaselineSignature} from '../src/engine';
const task=(id:string,predecessors:string[]=[]):ActivityDefinition=>({id,name:id,category:'wall',quantity:1,unit:'ea',productivity:1,minDuration:1,predecessors,crewDemand:1,maxCrews:1,leadTime:0,fixedDuration:2,quantityMode:'manual',productivityMode:'manual'});
function fixture(){const project=createDemoProject();for(const allowance of project.allowances)if(allowance.amount===null)allowance.amount=100000;project.schedule.activities=[task('a'),task('b',['a'])];project.schedule.procurementDays=0;return project;}
function approved(project:ReturnType<typeof fixture>,extra:Partial<SequenceAlternative>={}):SequenceAlternative{return{id:'independent-work',name:'Approved independent work fronts',approved:true,rationale:'Planner confirmed these fixture tasks operate in separate work areas.',baselineSignature:sequenceBaselineSignature(project),predecessors:{b:[]},...extra};}

describe('approved baseline-bound sequencing alternatives',()=>{
 it('compares an explicitly approved network and retains its rationale and exact predecessor diff',()=>{
  const project=fixture(),input=JSON.stringify(project);project.schedule.sequenceAlternatives=[approved(project)];const baselineInput=JSON.stringify(project);
  const scenarios=compareScenarios(project,'tradeoffs'),alternative=scenarios.find(scenario=>scenario.sequenceAlternativeId==='independent-work')!;
  expect(alternative).toBeDefined();expect(alternative.schedule.workingDays).toBe(2);expect(scenarios[0].schedule.workingDays).toBe(4);
  expect(alternative.sequenceChanges).toEqual([{activityId:'b',before:['a'],after:[]}]);expect(alternative.sequenceRationale).toMatch(/Planner confirmed/);
  expect(alternative.searchInfo?.approvedSequenceIds).toEqual(['independent-work']);expect(JSON.stringify(project)).toBe(baselineInput);expect(input).not.toBe(baselineInput);
 });
 it('never searches unapproved, cyclic, unknown or locked dependency variants',()=>{
  const project=fixture();project.schedule.sequenceAlternatives=[approved(project,{approved:false})];
  expect(compareScenarios(project,'tradeoffs').every(scenario=>!scenario.sequenceAlternativeId)).toBe(true);
  expect(compareScenarios(project,'tradeoffs')[0].schedule.issues.join(' ')).toMatch(/not approved/);
  expect(previewSequenceAlternative(project,approved(project,{predecessors:{a:['b']}})).issues.join(' ')).toMatch(/cycle/);
  expect(previewSequenceAlternative(project,approved(project,{predecessors:{unknown:[]}})).issues.join(' ')).toMatch(/Unknown activity/);
  project.constraints.lockedProperties=['schedule.activities.b.predecessors'];expect(previewSequenceAlternative(project,approved(project)).issues.join(' ')).toMatch(/locked/);
 });
 it('invalidates approvals when baseline dependencies, activity IDs or source selections change',()=>{
  const project=fixture(),alternative=approved(project);project.schedule.activities[0].sourceElementIds=['wall-n-00'];
  expect(previewSequenceAlternative(project,alternative).issues.join(' ')).toMatch(/changed after approval/);
  alternative.baselineSignature=sequenceBaselineSignature(project);project.schedule.activities.push(task('c'));
  expect(previewSequenceAlternative(project,alternative).issues.join(' ')).toMatch(/changed after approval/);
 });
 it('normalizes predecessor ordering but does not reapprove a changed dependency network',()=>{
  const project=fixture();project.schedule.activities=[task('a'),task('b'),task('c',['a','b'])];const signature=sequenceBaselineSignature(project);
  project.schedule.activities[2].predecessors=['b','a'];expect(sequenceBaselineSignature(project)).toBe(signature);
  project.schedule.activities[2].predecessors=['a'];expect(sequenceBaselineSignature(project)).not.toBe(signature);
 });
 it('respects full schedule locks and checks resource/calendar/deadline feasibility again',()=>{
  const project=fixture();project.schedule.sequenceAlternatives=[approved(project)];project.constraints.lockedProperties=['schedule'];
  const locked=compareScenarios(project,'tradeoffs');expect(locked.every(scenario=>!scenario.sequenceAlternativeId&&scenario.crews===project.schedule.crews&&scenario.procurementDays===project.schedule.procurementDays)).toBe(true);
  project.constraints.lockedProperties=[];project.constraints.deadline='2026-11-02';
  const impossible=compareScenarios(project,'time');expect(impossible.every(scenario=>!scenario.feasible)).toBe(true);expect(impossible[0].reasons.join(' ')).toMatch(/later than deadline/);
 });
 it('caps combinations explicitly and exposes incomplete bounded-search coverage',()=>{
  const project=fixture();project.schedule.crews=2;project.constraints.maxCrews=6;project.schedule.procurementDays=10;
  for(const type of [...project.types].filter(type=>['wall','door','window','slab'].includes(type.kind)))for(let i=0;i<2;i++)project.types.push({...type,id:`${type.id}-extra-${i}`,name:`Alternative ${type.id} ${i}`,approved:true});
  project.schedule.sequenceAlternatives=Array.from({length:6},(_,i)=>approved(project,{id:`sequence-${i}`,name:`Approved front ${i}`}));
  const baseline=compareScenarios(project,'tradeoffs')[0];expect(baseline.searchInfo).toMatchObject({evaluated:128,limit:128,truncated:true});expect(baseline.searchInfo!.totalCandidates).toBeGreaterThan(128);
  expect(baseline.schedule.issues.join(' ')).toMatch(/non-dominated only among evaluated/);
 });
 it('requires bounded typed sequence metadata in project imports and rejects ambiguous duplicate IDs',()=>{
  const project=fixture();project.schedule.sequenceAlternatives=[approved(project),approved(project)];
  expect(previewSequenceAlternative(project,project.schedule.sequenceAlternatives[0]).issues.join(' ')).toMatch(/IDs must be unique/);
  project.schedule.sequenceAlternatives=[approved(project)];expect(projectSchema.safeParse(project).success).toBe(true);
  delete (project.schedule.sequenceAlternatives[0]as Partial<SequenceAlternative>).baselineSignature;expect(projectSchema.safeParse(project).success).toBe(false);
 });
});
