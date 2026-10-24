import {describe,expect,it} from 'vitest';
import {createDemoProject} from '../src/domain/seed';
import type {Project} from '../src/domain/types';
import type {ServicePlan} from '../src/services/types';
import {serviceModelSignature} from '../src/services/model';
import {calculateDrainageFall,calculateElectricalDemand,calculateServiceEstimate,calculateServiceProgramme,defaultServiceAssumptions,serviceRouteLength} from '../src/services/calculations';
import {estimate} from '../src/engine/cost';
import {buildSchedule,generateActivities,scheduleActivitySignature,scheduleModelSignature} from '../src/engine/schedule';
import {acceptScheduleRefresh,previewScheduleRefresh} from '../src/engine/modelImpact';

function fixture():{project:Project;plan:ServicePlan} {
 const project=createDemoProject();project.schedule.activities=[];project.schedule.modelReviewRequired=false;delete project.schedule.modelReview;
 const assumptions=defaultServiceAssumptions(project.currency);
 const plan:ServicePlan={schemaVersion:1,status:'concept',modelSignature:serviceModelSignature(project),assumptions,notes:[],points:[
  {id:'panel',name:'Panel',kind:'panel',levelId:project.levels[0].id,offset:{x:0,y:0,z:0},loadWatts:null},
  {id:'light',name:'Light',kind:'light',levelId:project.levels[0].id,offset:{x:8,y:4,z:12},loadWatts:1000,circuitId:'lighting'},
  {id:'socket',name:'Socket',kind:'socket',levelId:project.levels[0].id,offset:{x:0,y:3,z:0},loadWatts:1300,circuitId:'power'},
 ],routes:[{id:'route',system:'electrical',fromId:'panel',toId:'light',circuitId:'lighting',points:[{x:0,y:0,z:0},{x:3,y:4,z:12},{x:8,y:4,z:12}]},{id:'socket-route',system:'electrical',fromId:'panel',toId:'socket',circuitId:'power',points:[{x:0,y:0,z:0},{x:0,y:3,z:0}]}]};
 project.services=plan;
 return {project,plan};
}
function quoted(plan:ServicePlan){plan.assumptions.rateSource='Independent arithmetic test fixture — not market rates';plan.assumptions.rateDate='2026-10-24';for(const rate of plan.assumptions.rates){rate.material=10;rate.labour=2;rate.productivity=rate.unit==='m'?2:1;}}

describe('Transparent limited services calculations',()=>{
 it('starts without market quotations or productivity, regardless of currency',()=>{
  for(const currency of ['INR','USD','EUR'] as const){const assumptions=defaultServiceAssumptions(currency);expect(assumptions.currency).toBe(currency);expect(assumptions.rates.every(rate=>rate.material===null&&rate.labour===null&&rate.productivity===null)).toBe(true);}
 });
 it('measures analytic 3D centreline lengths, not planar distance or cable quantity',()=>{
  expect(serviceRouteLength([{x:0,y:0,z:0},{x:3,y:4,z:12},{x:8,y:4,z:12}])).toBe(18); // √169 + 5
  expect(serviceRouteLength([{x:0,y:0,z:0},{x:0,y:0,z:0}])).toBeNull();
  expect(serviceRouteLength([{x:0,y:0,z:0},{x:NaN,y:0,z:0}])).toBeNull();
 });
 it('uses real power / (single-phase RMS voltage × power factor), with explicit demand factor',()=>{
  const {plan}=fixture();Object.assign(plan.assumptions,{voltage:230,powerFactor:1,demandFactor:.5});
  expect(calculateElectricalDemand(plan)).toMatchObject({connectedWatts:2300,diversifiedWatts:1150,currentAmps:5,unknownLoadCount:0});
  plan.assumptions.powerFactor=.5;expect(calculateElectricalDemand(plan).currentAmps).toBe(10);
  plan.points[1].loadWatts=null;expect(calculateElectricalDemand(plan)).toMatchObject({connectedWatts:null,currentAmps:null,unknownLoadCount:1});
 });
 it('rejects invalid demand assumptions and leaves incomplete loads unknown',()=>{
  const {plan}=fixture();plan.assumptions.demandFactor=1.2;expect(calculateElectricalDemand(plan).currentAmps).toBeNull();
  plan.assumptions.demandFactor=.7;plan.assumptions.powerFactor=0;expect(calculateElectricalDemand(plan).currentAmps).toBeNull();
  plan.points[1].loadWatts=-1;expect(calculateElectricalDemand(plan).unknownLoadCount).toBe(1);
  plan.points=[];expect(calculateElectricalDemand(plan).connectedWatts).toBeNull();
 });
 it('computes fall from horizontal run and a user ratio, without choosing a statutory slope',()=>{
  expect(calculateDrainageFall(12,60).fallMetres).toBe(.2);
  expect(calculateDrainageFall(5,100).fallMetres).toBe(.05);
  expect(calculateDrainageFall(12,0).fallMetres).toBeNull();
  expect(calculateDrainageFall(-1,60).fallMetres).toBeNull();
 });
 it('keeps unknown quotations unknown and known components in a subtotal',()=>{
  const {project,plan}=fixture();expect(calculateServiceEstimate(project,plan)).toMatchObject({total:null,knownSubtotal:0,completeness:0,unknownCount:4,routeLengthMetres:21});
  quoted(plan);plan.assumptions.wastePercent=10;
  // 3 points + 21 m: material240, labour48, waste24.
  expect(calculateServiceEstimate(project,plan)).toMatchObject({total:312,knownSubtotal:312,completeness:100});
  plan.assumptions.rates.find(rate=>rate.key==='route:electrical')!.labour=null;
  expect(calculateServiceEstimate(project,plan)).toMatchObject({total:null,knownSubtotal:270,unknownCount:1});
 });
 it('does not convert mismatched currencies or call excluded components savings',()=>{
  const {project,plan}=fixture();quoted(plan);plan.assumptions.currency='USD';
  const result=calculateServiceEstimate(project,plan);expect(result.total).toBeNull();expect(result.knownSubtotal).toBe(0);expect(result.issues.join(' ')).toMatch(/No conversion/);
 });
 it('suppresses stale cost/length/installation duration after a host model change',()=>{
  const {project,plan}=fixture();quoted(plan);project.elements.find(element=>element.kind==='room')!.x+=1;
  expect(calculateServiceEstimate(project,plan)).toMatchObject({current:false,total:null,knownSubtotal:0,routeLengthMetres:0});
  expect(calculateServiceProgramme(project,plan)).toMatchObject({current:false,crewDays:null,workDays:null});
  expect(buildSchedule(project).feasible).toBe(false);
 });
 it('derives sequential work from entered productivity and never scales it linearly by available crews',()=>{
  const {project,plan}=fixture();expect(calculateServiceProgramme(project,plan).workDays).toBeNull();quoted(plan);
  expect(calculateServiceProgramme(project,plan)).toMatchObject({crewDays:13.5,workDays:14}); // 21/2 + 3/1; route phase11 days + point phase3 days
  plan.assumptions.crews=4;expect(calculateServiceProgramme(project,plan).workDays).toBe(14);
 });
 it('rounds rough-in and fit-off phase effort once, matching the mapped construction task durations',()=>{
  const {project,plan}=fixture();quoted(plan);for(const rate of plan.assumptions.rates)if(rate.unit==='ea')rate.productivity=4;
  // Routes 21/2 =10.5 crew-days; points3/4 =.75: phase duration11+1=12,
  // rather than rounding each of the three point-rate rows separately (14).
  expect(calculateServiceProgramme(project,plan)).toMatchObject({crewDays:11.25,workDays:12});
  const schedule=buildSchedule(project);expect(schedule.feasible).toBe(true);expect(schedule.activities.filter(activity=>activity.servicePackage).reduce((sum,activity)=>sum+activity.duration,0)).toBe(12);
 });
 it('adds service cost to the overall estimate and flags overlapping independent allowance',()=>{
  const {project,plan}=fixture();quoted(plan);project.allowances=[];project.schedule.overheadPerDay=0;
  const noServices=structuredClone(project);delete noServices.services;
  expect(estimate(project).total-estimate(noServices).total).toBe(288);
  project.allowances.push({id:'mep',name:'MEP services',amount:500,included:true});
  expect(estimate(project).issues.join(' ')).toMatch(/may overlap/);expect(estimate(project).completeness).toBeLessThan(100);
 });
 it('replaces only new-template proxy services with mapped rough-in and fit-off work',()=>{
  const {project,plan}=fixture();quoted(plan);
  const activities=generateActivities(project);expect(activities.some(activity=>activity.id==='mep')).toBe(false);
  expect(activities.find(activity=>activity.servicePackage==='routes')?.predecessors).toEqual(['walls']);
  expect(activities.find(activity=>activity.servicePackage==='points')?.predecessors).toEqual(['internal-finishes']);
  expect(buildSchedule(project).feasible).toBe(true);
  project.schedule.activities=[{id:'manual',name:'Manual services scope',category:'allowance',quantity:1,unit:'scope',productivity:1,minDuration:1,predecessors:[],crewDemand:1,maxCrews:1,leadTime:0,fixedDuration:7}];
  expect(buildSchedule(project).activities).toHaveLength(1);expect(buildSchedule(project).issues.join(' ')).toMatch(/remain unchanged/);
 });
 it('proposes updated service effort for explicit scope acceptance; a route revision invalidates reviewed dates',()=>{
  const {project,plan}=fixture();quoted(plan);project.schedule.activities=generateActivities(project);
  project.schedule.modelReview={modelSignature:scheduleModelSignature(project),activitySignature:scheduleActivitySignature(project.schedule.activities),acceptedAt:'2026-10-24'};
  const before=buildSchedule(project);expect(before.feasible).toBe(true);
  plan.routes[0].points[2].x=28;plan.points[1].offset.x=28;
  expect(buildSchedule(project).feasible).toBe(false);
  const preview=previewScheduleRefresh(project);const change=preview.changes.find(change=>change.after?.servicePackage==='routes');
  expect(change?.after?.productivity).toBeCloseTo(1/20.5);
  expect(change?.beforeSourceIds).toEqual(['route','socket-route']);expect(change?.afterSourceIds).toEqual(['route','socket-route']);
  expect(change?.after?.sourceElementIds).toBeUndefined();
  expect(preview.changes.find(change=>change.after?.servicePackage==='points')?.afterSourceIds).toEqual(['light','panel','socket']);
  const reviewed=acceptScheduleRefresh(project,preview,'editor');expect(buildSchedule(reviewed).feasible).toBe(true);expect(buildSchedule(reviewed).durationDays).toBeGreaterThan(before.durationDays);
 });
 it('does not trust a matching architecture stamp when routes, hosts or references are corrupt',()=>{
  const corruptions:Array<(plan:ServicePlan)=>void>=[
   plan=>{plan.points[1].roomId='removed-room';},
   plan=>{plan.points[1].levelId='missing-level';},
   plan=>{plan.routes[0].points[2].x=100;},
   plan=>{plan.routes[0].toId='missing-point';},
   plan=>{plan.routes.pop();},
   plan=>{plan.routes.push(structuredClone(plan.routes[0]));},
  ];
  for(const corrupt of corruptions){const {project,plan}=fixture();quoted(plan);corrupt(plan);plan.modelSignature=serviceModelSignature(project);
   expect(calculateServiceEstimate(project,plan)).toMatchObject({current:false,total:null,knownSubtotal:0,routeLengthMetres:0});
   expect(calculateServiceProgramme(project,plan).workDays).toBeNull();expect(buildSchedule(project).feasible).toBe(false);
  }
 });
 it('reports exact before/after service source membership without persisting architectural source selectors',()=>{
  const {project,plan}=fixture();quoted(plan);project.schedule.activities=generateActivities(project);const baseline=structuredClone(project);
  plan.points[2].id='socket-revised';plan.routes[1].id='route-revised';plan.routes[1].toId='socket-revised';
  const preview=previewScheduleRefresh(project,baseline),routes=preview.changes.find(change=>change.after?.servicePackage==='routes'),points=preview.changes.find(change=>change.after?.servicePackage==='points');
  expect(routes?.beforeSourceIds).toEqual(['route','socket-route']);expect(routes?.afterSourceIds).toEqual(['route','route-revised']);
  expect(points?.beforeSourceIds).toEqual(['light','panel','socket']);expect(points?.afterSourceIds).toEqual(['light','panel','socket-revised']);
  expect(preview.staleSourceIds).toEqual([]);expect(preview.activities.filter(activity=>activity.servicePackage).every(activity=>activity.sourceElementIds===undefined)).toBe(true);
 });
 it('does not produce negative, overflowing or infinite engineering/cost outputs',()=>{
  const {project,plan}=fixture();quoted(plan);plan.assumptions.rates[0].material=-1;
  expect(calculateServiceEstimate(project,plan)).toMatchObject({current:false,total:null,knownSubtotal:0});
  plan.assumptions.rates[0].material=1e308;expect(calculateServiceEstimate(project,plan).total).toBeNull();
  plan.assumptions.powerFactor=Number.MIN_VALUE;expect(calculateElectricalDemand(plan).currentAmps).toBeNull();
  expect(calculateDrainageFall(Number.MAX_VALUE,Number.MIN_VALUE).fallMetres).toBeNull();
 });
 it('suppresses combined monetary overflow even when every route-system component is individually representable',()=>{
  const {project,plan}=fixture();quoted(plan);
  plan.points[1].offset={x:40000,y:0,z:0};plan.routes[0].points=[{x:0,y:0,z:0},{x:40000,y:0,z:0}];
  plan.points.push({id:'inlet',name:'Inlet',kind:'water-inlet',levelId:project.levels[0].id,offset:{x:0,y:0,z:0},loadWatts:null},{id:'sink',name:'Sink',kind:'sink',levelId:project.levels[0].id,offset:{x:40000,y:0,z:0},loadWatts:null},{id:'outlet',name:'Outlet',kind:'drain-outlet',levelId:project.levels[0].id,offset:{x:0,y:0,z:0},loadWatts:null});
  plan.routes.push({id:'water-route',system:'cold-water',fromId:'inlet',toId:'sink',points:[{x:0,y:0,z:0},{x:40000,y:0,z:0}]},{id:'drain-route',system:'drainage',fromId:'sink',toId:'outlet',points:[{x:40000,y:0,z:0},{x:0,y:0,z:0}]});
  for(const rate of plan.assumptions.rates){rate.material=rate.unit==='m'?1e9:0;rate.labour=0;}
  const result=calculateServiceEstimate(project,plan);expect(result.current).toBe(true);expect(result.total).toBeNull();expect(result.knownSubtotal).toBe(0);expect(result.lines.every(line=>line.material===null&&line.total===null)).toBe(true);expect(result.issues.join(' ')).toMatch(/Combined.*precision/);
 });
 it('rejects forged mapped task quantities even when a raw save omits the review stamp',()=>{
  const mutations:Array<(activity:ReturnType<typeof generateActivities>[number])=>void>=[
   activity=>{activity.quantity=.01;},activity=>{activity.productivity=1000;},activity=>{activity.fixedDuration=1;},activity=>{activity.category='wall';},
  ];
  for(const mutate of mutations){const {project,plan}=fixture();quoted(plan);project.schedule.activities=generateActivities(project);const routes=project.schedule.activities.find(activity=>activity.servicePackage==='routes')!;mutate(routes);delete project.schedule.modelReview;
   expect(buildSchedule(project).feasible).toBe(false);expect(buildSchedule(project).issues.join(' ')).toMatch(/mapped service effort/);
  }
 });
 it('requires each mapped installation phase exactly once and refuses orphaned mapped tasks',()=>{
  const {project,plan}=fixture();quoted(plan);project.schedule.activities=generateActivities(project);
  const points=project.schedule.activities.find(activity=>activity.servicePackage==='points')!;delete points.servicePackage;
  expect(buildSchedule(project).feasible).toBe(false);
  points.servicePackage='points';project.schedule.activities.push({...points,id:'duplicate-points'});expect(buildSchedule(project).feasible).toBe(false);
  project.schedule.activities.pop();delete project.services;expect(buildSchedule(project).feasible).toBe(false);
 });
});
