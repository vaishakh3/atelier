import { describe, expect, it } from 'vitest';
import type { ActivityDefinition, BimElement, Project } from '../src/domain/types';
import { buildSchedule, compareScenarios, estimate, generateActivities, quantities } from '../src/engine';

function activity(id:string, predecessors:string[] = [], duration = 2, crewDemand = 1):ActivityDefinition {
  return { id, name:id, category:'wall', quantity:20, unit:'m²', productivity:10, minDuration:1, predecessors, crewDemand, maxCrews:crewDemand, leadTime:0, fixedDuration:duration };
}
function project():Project {
  const wall:BimElement = { id:'wall-1', kind:'wall', name:'South wall', levelId:'ground', typeId:'wall-type', material:'Brick', x:0, y:0, z:0, width:10, depth:0.2, height:3, rotation:0, editable:true, properties:{} };
  return {
    schemaVersion:1, id:'fixture', name:'Regression house', description:'Independent deterministic fixture', location:'Pilot', units:'m', currency:'INR', version:3, createdAt:'2026-10-24', updatedAt:'2026-10-24', levels:[{id:'ground', name:'Ground', elevation:0}], grids:[],
    elements:[wall, { ...wall, id:'door-1', kind:'door', name:'Door', typeId:'door-type', material:'Timber', x:1,width:1, depth:0.1, height:2, hostId:'wall-1' }, { ...wall, id:'window-1', kind:'window', name:'Window', typeId:'window-type', material:'Aluminium', x:3,z:1,width:2, depth:0.1, height:1.5, hostId:'wall-1' }, { ...wall, id:'slab-1', kind:'slab', name:'Floor', typeId:'slab-type', material:'Concrete', width:10, depth:8, height:0.15 }, { ...wall, id:'room-1', kind:'room', name:'Living', typeId:'room-type', material:'', width:5, depth:4, height:3 }],
    types:[
      {id:'wall-type',name:'Brick wall',kind:'wall',material:'Brick',unit:'m²',materialRate:100,labourRate:20,equipmentRate:0,wastePercent:10,approved:true,productivity:10,rateDate:'2026-10-01'},
      {id:'wall-alt',name:'Approved block wall',kind:'wall',material:'Block',unit:'m²',materialRate:70,labourRate:15,equipmentRate:0,wastePercent:5,approved:true,productivity:12,rateDate:'2026-10-01'},
      {id:'door-type',name:'Timber door',kind:'door',material:'Timber',unit:'ea',materialRate:500,labourRate:50,equipmentRate:0,wastePercent:0,approved:true,productivity:5,rateDate:'2026-10-01'},
      {id:'window-type',name:'Window',kind:'window',material:'Aluminium',unit:'ea',materialRate:300,labourRate:30,equipmentRate:0,wastePercent:0,approved:true,productivity:5,rateDate:'2026-10-01'},
      {id:'slab-type',name:'Slab',kind:'slab',material:'Concrete',unit:'m²',materialRate:50,labourRate:10,equipmentRate:5,wastePercent:0,approved:true,productivity:20,rateDate:'2026-10-01'},
      {id:'room-type',name:'Room',kind:'room',material:'',unit:'m²',materialRate:null,labourRate:null,equipmentRate:null,wastePercent:0,approved:true,productivity:1,rateDate:''},
    ],
    allowances:[{id:'foundation',name:'Foundation scope',amount:1000,included:true}],
    schedule:{ startDate:'2026-11-02', workingDays:[1,2,3,4,5], crews:1, crewCostPerDay:0, overheadPerDay:100, procurementDays:0, activities:[activity('a'), activity('b', ['a'])] },
    constraints:{ budget:20000,deadline:'2026-12-31',maxCrews:3,lockedElementIds:[],lockedProperties:[] }, audit:[],
  };
}

describe('Deterministic quantity engine', () => {
  it('deducts hosted openings from wall area without changing opening counts', () => {
    const measured = quantities(project());
    expect(measured.find(line => line.elementId === 'wall-1')?.quantity).toBe(25);
    expect(measured.find(line => line.elementId === 'door-1')?.quantity).toBe(1);
    expect(measured.find(line => line.elementId === 'slab-1')?.quantity).toBe(80);
    expect(measured.find(line => line.elementId === 'room-1')?.quantity).toBe(20);
  });
  it('converts net wall area to volume when the assembly rate uses m³', () => {
    const input = project(); input.types[0].unit = 'm³';
    expect(quantities(input)[0]).toMatchObject({ quantity:5, unit:'m³' });
  });
  it('uses canonical metres regardless of display-unit preference', () => {
    const input = project(); input.units = 'ft';
    expect(quantities(input)[0].quantity).toBe(25);
  });
  it('flags invalid geometry and missing types', () => {
    const input = project(); input.elements[0].width = -3; input.elements[0].typeId = 'unknown';
    expect(quantities(input)[0].issues.join(' ')).toMatch(/missing.*negative/);
    expect(estimate(input).completeness).toBeLessThan(100);
  });
  it('deducts overlapping hosted openings once and flags the unresolved collision',()=>{
    const input=project();input.elements[2].x=1.5;input.elements[2].z=0;
    const line=quantities(input).find(item=>item.elementId==='wall-1')!;
    expect(line.quantity).toBe(25.75);
    expect(line.issues.join(' ')).toMatch(/overlap.*union/);
    expect(estimate(input).completeness).toBeLessThan(100);
  });
  it('clips out-of-bounds openings to the wall and does not rank the invalid geometry as complete',()=>{
    const input=project();input.elements[2].x=9;
    const line=quantities(input).find(item=>item.elementId==='wall-1')!;
    expect(line.quantity).toBe(26.5);
    expect(line.issues.join(' ')).toMatch(/outside host wall bounds/);
    expect(estimate(input).completeness).toBeLessThan(100);
  });
});

describe('Traceable cost engine', () => {
  it('includes independent allowances, material waste and calendar overhead', () => {
    const result = estimate(project());
    // Wall 25×(100+20)+250 waste=3250; door550; window330; slab5200; allowance1000; 4 days overhead400.
    expect(result.total).toBe(10730);
    expect(result.waste).toBe(250);
    expect(result.allowances).toBe(1000);
    expect(result.completeness).toBe(100);
    expect(result.lines.find(line => line.id.startsWith('type:wall-type'))?.sourceIds).toEqual(['wall-1']);
    expect(result.lines.find(line => line.id.startsWith('type:wall-type'))?.rateDate).toBe('2026-10-01');
    expect(result.lines.some(line => line.sourceIds.includes('room-1'))).toBe(false);
  });
  it('keeps a missing rate unknown instead of presenting the item as free', () => {
    const input = project(); input.types[0].materialRate = null;
    const result = estimate(input);
    expect(result.lines.find(line => line.id.startsWith('type:wall-type'))?.total).toBeNull();
    expect(result.completeness).toBeLessThan(100);
    expect(result.issues.join(' ')).toMatch(/unknown, not free/);
  });
  it('treats unknown and excluded allowances differently', () => {
    const input = project(); input.allowances.push({id:'mep',name:'MEP',amount:null,included:true},{id:'tax',name:'Taxes',amount:500,included:false});
    const result = estimate(input);
    expect(result.allowances).toBe(1000);
    expect(result.completeness).toBeLessThan(100);
    expect(result.issues.join(' ')).toMatch(/Excluded scope: Taxes/);
  });
  it('requires explicit incremental crew charges and discloses double-counting risk', () => {
    const input = project(); input.schedule.crewCostPerDay = 25;
    const result = estimate(input);
    expect(result.total).toBe(10830);
    expect(result.issues.join(' ')).toMatch(/already included in unit labour/);
  });
  it('keeps a mismatched-currency rate unknown instead of silently relabelling its amount',()=>{
    const input=project();input.types[0].rateCurrency='USD';input.types[0].rateSource='Supplier quote Q-42';
    const result=estimate(input),line=result.lines.find(item=>item.id.startsWith('type:wall-type'))!;
    expect(line.total).toBeNull();expect(line.material).toBeNull();expect(line.rateCurrency).toBe('USD');
    expect(result.completeness).toBeLessThan(100);expect(line.issues.join(' ')).toMatch(/does not match project currency/);
    input.types[0].rateCurrency='INR';expect(estimate(input).lines.find(item=>item.id===line.id)?.rateSource).toBe('Supplier quote Q-42');
  });
  it('rejects arithmetic overflow instead of exporting Infinity or fictitious free work',()=>{
    const input=project();input.types[0].materialRate=1e308;
    const cost=estimate(input);expect(cost.lines.find(line=>line.id.startsWith('type:wall-type'))?.material).toBeNull();expect(Number.isFinite(cost.total)).toBe(true);expect(cost.completeness).toBeLessThan(100);
    input.elements[0].width=1e308;input.elements[0].height=1e308;
    const measured=quantities(input)[0];expect(Number.isFinite(measured.quantity)).toBe(true);expect(measured.issues.join(' ')).toMatch(/Invalid measurement/);
  });
});

describe('Calendar and resource schedule', () => {
  it('uses quantity/productivity with ceiling and minimum duration', () => {
    const input = project(); input.schedule.activities = [{...activity('a'), fixedDuration:undefined,quantity:21,productivity:10}];
    expect(buildSchedule(input).activities[0].duration).toBe(3);
  });
  it('skips weekends and charges overhead over elapsed calendar days', () => {
    const input = project(); input.schedule.startDate='2026-11-06'; input.schedule.activities=[activity('a',[],2)];
    const result = buildSchedule(input);
    expect(result.finishDate).toBe('2026-11-09');
    expect(result.workingDays).toBe(2);
    expect(result.durationDays).toBe(4);
    expect(estimate(input,result).overhead).toBe(400);
  });
  it('applies explicit holiday exceptions without consuming crew working days',()=>{
    const input=project();input.schedule.activities=[activity('a',[],2)];input.schedule.holidays=['2026-11-03'];
    const result=buildSchedule(input);
    expect(result.finishDate).toBe('2026-11-04');expect(result.workingDays).toBe(2);expect(result.durationDays).toBe(3);expect(result.crewDays).toBe(2);
    input.schedule.holidays=['2026-02-30'];expect(buildSchedule(input).feasible).toBe(false);
  });
  it('shifts a weekend project start to the next working date', () => {
    const input=project();input.schedule.startDate='2026-11-07';input.schedule.activities=[activity('a',[],1)];
    expect(buildSchedule(input).startDate).toBe('2026-11-09');
  });
  it('rejects cycles and missing predecessor references', () => {
    const input=project();input.schedule.activities=[activity('a',['b']),activity('b',['a'])];
    expect(buildSchedule(input)).toMatchObject({ feasible:false });
    expect(buildSchedule(input).issues.join(' ')).toMatch(/cycle/);
    input.schedule.activities=[activity('a',['absent'])];
    expect(buildSchedule(input).issues.join(' ')).toMatch(/unknown activity/);
  });
  it('extra crews enable parallel work without dividing individual task durations', () => {
    const input=project();input.schedule.activities=[activity('a',[],4),activity('b',[],4),activity('c',['a','b'],2)];
    const serial=buildSchedule(input),parallel=buildSchedule(input,{crews:2});
    expect(serial.workingDays).toBe(10);
    expect(parallel.workingDays).toBe(6);
    expect(parallel.activities.find(item=>item.id==='a')?.duration).toBe(4);
    expect(parallel.crewDays).toBe(serial.crewDays);
  });
  it('respects finite crew pools at every working day', () => {
    const input=project();input.schedule.activities=[activity('a',[],3),activity('b',[],3),activity('c',[],3),activity('d',['a','b','c'])];
    const result=buildSchedule(input,{crews:2});
    for(let day=0;day<result.durationDays;day++) {
      expect(result.activities.filter(item=>item.startDay<=day&&item.finishDay>=day).reduce((sum,item)=>sum+item.assignedCrews,0)).toBeLessThanOrEqual(2);
    }
    expect(result.criticalPath.length).toBeGreaterThan(0);
  });
  it('rejects unsupported crew demand and unknown productivity', () => {
    const input=project();input.schedule.activities=[activity('a',[],2,2)];
    expect(buildSchedule(input).issues.join(' ')).toMatch(/only 1/);
    input.schedule.activities=[{...activity('a'),fixedDuration:undefined,productivity:0}];
    expect(buildSchedule(input).issues.join(' ')).toMatch(/unknown duration is not zero/);
  });
  it('respects calendar procurement release independently from predecessor duration', () => {
    const input=project();input.schedule.activities=[{...activity('a',[],1),leadTime:5}];
    const result=buildSchedule(input,{procurementDays:2});
    expect(result.activities[0].startDate).toBe('2026-11-09');
    expect(result.durationDays).toBe(8);
  });
  it('generates a connected low-rise template and explicitly identifies assumed scope', () => {
    const input=project();input.schedule.activities=[];
    expect(generateActivities(input).map(item=>item.id)).toContain('foundations');
    const result=buildSchedule(input);
    expect(result.feasible).toBe(true);
    expect(result.issues.join(' ')).toMatch(/unmodelled scope/);
  });
  it('recomputes stored model-linked quantities and duration after model edits', () => {
    const input=project();
    input.schedule.activities=[{...activity('walls'),fixedDuration:undefined,quantity:999,quantityMode:'model',category:'wall',unit:'m²',productivity:10}];
    expect(buildSchedule(input).activities[0]).toMatchObject({quantity:25,duration:3});
    input.elements[0].width=20;
    expect(buildSchedule(input).activities[0]).toMatchObject({quantity:55,duration:6});
    expect(input.schedule.activities[0].quantity).toBe(999);
  });
  it('retains planner-entered manual quantities after model changes', () => {
    const input=project();
    input.schedule.activities=[{...activity('walls'),fixedDuration:undefined,quantity:40,quantityMode:'manual',category:'wall',unit:'m²',productivity:10}];
    input.elements[0].width=20;
    expect(buildSchedule(input).activities[0]).toMatchObject({quantity:40,duration:4});
  });
  it('deduplicates explicit element selections and excludes unrelated categories', () => {
    const input=project();
    input.elements.push({...input.elements[0],id:'wall-2',name:'Additional wall'});
    input.schedule.activities=[{...activity('walls'),fixedDuration:undefined,quantity:0,quantityMode:'model',sourceElementIds:['wall-1','wall-1','door-1'],category:'wall',unit:'m²',productivity:10}];
    const result=buildSchedule(input);
    expect(result.activities[0].quantity).toBe(25);
    expect(result.issues.join(' ')).toMatch(/do not match wall/);
    delete input.schedule.activities[0].sourceElementIds;
    expect(buildSchedule(input).activities[0].quantity).toBe(55);
  });
  it('preserves model linkage when generated definitions are stored and includes new elements', () => {
    const input=project();input.schedule.activities=generateActivities(input);
    const before=buildSchedule(input).activities.find(item=>item.id==='walls')!.quantity;
    input.elements.push({...input.elements[0],id:'wall-2',name:'Additional wall'});
    const after=buildSchedule(input).activities.find(item=>item.id==='walls')!.quantity;
    expect(after-before).toBe(30);
    expect(input.schedule.activities.find(item=>item.id==='foundations')?.quantityMode).toBe('manual');
    expect(input.schedule.activities.filter(item=>item.quantityMode==='model'&&item.category==='wall')).toHaveLength(1);
  });
  it('recomputes duration from a slower approved replacement assembly', () => {
    const input=project();input.types[1].productivity=5;
    input.schedule.activities=[{...activity('walls'),fixedDuration:undefined,quantity:25,quantityMode:'model',productivityMode:'type',category:'wall',unit:'m²'}];
    const before=buildSchedule(input);
    expect(before.activities[0]).toMatchObject({quantity:25,duration:3,productivity:10});
    input.elements[0].typeId='wall-alt';input.elements[0].material='Block';
    const after=buildSchedule(input);
    expect(after.activities[0]).toMatchObject({quantity:25,duration:5,productivity:5});
    expect(after.finishDate>before.finishDate).toBe(true);
  });
  it('weights mixed assemblies by summed working days instead of averaging their rates', () => {
    const input=project();input.types[1].productivity=5;
    input.elements.push({...input.elements[0],id:'wall-2',name:'Block wall',typeId:'wall-alt',material:'Block'});
    input.schedule.activities=[{...activity('walls'),fixedDuration:undefined,quantity:0,quantityMode:'model',productivityMode:'type',category:'wall',unit:'m²'}];
    const result=buildSchedule(input).activities[0];
    expect(result.quantity).toBe(55);
    expect(result.productivity).toBeCloseTo(55/(25/10+30/5));
    expect(result.duration).toBe(9);
  });
  it('respects assembly native units when activity and rate measurement units differ', () => {
    const input=project();input.types[0].unit='m³';input.types[0].productivity=1;
    input.schedule.activities=[{...activity('walls'),fixedDuration:undefined,quantity:0,quantityMode:'model',productivityMode:'type',category:'wall',unit:'m²'}];
    expect(buildSchedule(input).activities[0]).toMatchObject({quantity:25,productivity:5,duration:5});
  });
  it('rejects missing assembly productivity while keeping manual productivity authoritative', () => {
    const input=project();input.types[0].productivity=0;
    input.schedule.activities=[{...activity('walls'),fixedDuration:undefined,quantity:25,quantityMode:'model',productivityMode:'type',category:'wall',unit:'m²'}];
    expect(buildSchedule(input)).toMatchObject({feasible:false});
    expect(buildSchedule(input).issues.join(' ')).toMatch(/invalid assembly productivity/);
    input.schedule.activities[0].productivityMode='manual';input.schedule.activities[0].productivity=10;
    expect(buildSchedule(input).activities[0].duration).toBe(3);
  });
});

describe('Bounded approved scenario comparison', () => {
  it('preserves the baseline and returns non-dominated approved substitutions', () => {
    const input=project();const original=JSON.stringify(input);
    const scenarios=compareScenarios(input,'tradeoffs');
    expect(scenarios[0].id).toBe('baseline');
    expect(scenarios.some(item=>item.typeChanges['wall-1']==='wall-alt')).toBe(true);
    expect(scenarios.filter(item=>item.id!=='baseline'&&item.feasible).every(item=>!item.dominated)).toBe(true);
    expect(JSON.stringify(input)).toBe(original);
  });
  it('respects locked elements and globally locked material specifications', () => {
    const input=project();input.constraints.lockedElementIds=['wall-1'];
    expect(compareScenarios(input,'tradeoffs').every(item=>!item.typeChanges['wall-1'])).toBe(true);
    input.constraints.lockedElementIds=[];input.constraints.lockedProperties=['material'];
    expect(compareScenarios(input,'tradeoffs').every(item=>!item.typeChanges['wall-1'])).toBe(true);
  });
  it('never recommends an unapproved cheaper type', () => {
    const input=project();input.types[1].approved=false;
    expect(compareScenarios(input,'tradeoffs').every(item=>!item.typeChanges['wall-1'])).toBe(true);
  });
  it('rejects unknown-cost candidates and explains impossible constraints', () => {
    const input=project();input.types.find(item=>item.id==='window-type')!.materialRate=null;input.constraints.budget=1;
    const scenarios=compareScenarios(input,'time');
    expect(scenarios.every(item=>!item.feasible)).toBe(true);
    expect(scenarios[0].reasons.join(' ')).toMatch(/No candidate.*bounded search/);
    expect(scenarios[0].reasons.join(' ')).toMatch(/complete/);
  });
  it('requires objective inputs rather than inventing a deadline or budget', () => {
    const input=project();input.constraints.deadline=null;
    expect(compareScenarios(input,'cost')[0].reasons.join(' ')).toMatch(/Set a deadline/);
    input.constraints.budget=null;
    expect(compareScenarios(input,'time')[0].reasons.join(' ')).toMatch(/Set a budget/);
  });
  it('keeps cheaper but slower material alternatives as explicit cost-time tradeoffs', () => {
    const input=project();input.types[1].productivity=5;
    input.schedule.activities=[{...activity('walls'),fixedDuration:undefined,quantity:25,quantityMode:'model',productivityMode:'type',category:'wall',unit:'m²'}];
    const scenarios=compareScenarios(input,'tradeoffs');
    const alternative=scenarios.find(item=>item.typeChanges['wall-1']==='wall-alt')!;
    expect(alternative).toBeDefined();
    expect(alternative.cost.total).toBeLessThan(scenarios[0].cost.total);
    expect(alternative.schedule.finishDate>scenarios[0].schedule.finishDate).toBe(true);
    expect(scenarios[0].dominated).toBe(false);
    expect(alternative.dominated).toBe(false);
  });
});
