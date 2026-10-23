import { describe,expect,it } from 'vitest';
import { createDemoProject } from '../src/domain/seed';
import { compareRevisions,quantities } from '../src/engine';

function fixture(){const project=createDemoProject();for(const allowance of project.allowances)if(allowance.amount===null)allowance.amount=100000;for(const type of project.types){type.rateCurrency='INR';type.rateSource='Estimator-reviewed regression fixture';}return project;}
describe('formal revision comparison',()=>{
 it('returns a reproducible no-change comparison without mutating either snapshot',()=>{
  const before=fixture(),after=structuredClone(before),input=JSON.stringify(before);
  const comparison=compareRevisions(before,after);
  expect(comparison.summary).toMatchObject({added:0,removed:0,modified:0,geometry:0,rates:0});
  expect(comparison.cost.delta).toBe(0);expect(comparison.schedule.calendarDaysDelta).toBe(0);
  expect(comparison).toEqual(compareRevisions(before,after));expect(JSON.stringify(before)).toBe(input);
 });
 it('separates added, removed, geometric, type and specification changes',()=>{
  const before=fixture(),after=structuredClone(before);after.version++;
  const window=after.elements.find(element=>element.kind==='window')!;window.width+=.1;window.properties.fireRating='EI30';window.typeId='window-thermal';window.material='Thermal-break aluminium';
  after.elements=after.elements.filter(element=>element.id!=='room-bed3');
  after.elements.push({...after.elements.find(element=>element.kind==='room')!,id:'new-room',name:'New room'});
  const comparison=compareRevisions(before,after);
  expect(comparison.summary).toMatchObject({added:1,removed:1,modified:1,types:1,specifications:1});
  const changed=comparison.elementChanges.find(change=>change.elementId===window.id)!;
  expect(changed.categories).toEqual(expect.arrayContaining(['geometry','type','specification']));
  expect(changed.fields.find(change=>change.field==='properties.fireRating')).toMatchObject({before:null,after:'EI30'});
  expect(comparison.quantityChanges.some(change=>change.elementId===window.hostId)).toBe(true);
 });
 it('matches unique external identifiers across independently assigned application IDs',()=>{
  const before=fixture();before.elements=[{...before.elements[0],externalId:'0u4wgLe6n0EwNRcVlaYd_r'}];
  const after=structuredClone(before);after.elements[0].id='imported-again';after.elements[0].width++;
  const comparison=compareRevisions(before,after);
  expect(comparison.summary).toMatchObject({added:0,removed:0,modified:1});
  expect(comparison.elementChanges[0]).toMatchObject({elementId:'imported-again',previousElementId:before.elements[0].id});
 });
 it('isolates rate revisions and derives the cost impact from measured source quantities',()=>{
  const before=fixture(),after=structuredClone(before);after.types[0].materialRate!+=100;
  const comparison=compareRevisions(before,after);
  const area=quantities(before).filter(line=>line.typeId===before.types[0].id).reduce((sum,line)=>sum+line.quantity,0);
  expect(comparison.elementChanges).toHaveLength(0);expect(comparison.rateChanges).toHaveLength(1);
  expect(comparison.cost.delta).toBeCloseTo(area*100*1.05,1);
  expect(comparison.schedule.calendarDaysDelta).toBe(0);
 });
 it('retains provisional subtotal change while refusing a total saving for unknown scope',()=>{
  const before=createDemoProject(),after=structuredClone(before);after.types[0].materialRate!+=10;
  const comparison=compareRevisions(before,after);
  expect(comparison.cost.complete).toBe(false);expect(comparison.cost.delta).toBeNull();
  expect(comparison.cost.knownSubtotalDelta).toBeGreaterThan(0);
  expect(comparison.issues.join(' ')).toMatch(/incomplete/);
 });
 it('does not subtract different currencies or different quantity units',()=>{
  const before=fixture(),after=structuredClone(before);after.currency='EUR';after.types[0].unit='m³';
  const comparison=compareRevisions(before,after);
  expect(comparison.cost.delta).toBeNull();expect(comparison.cost.knownSubtotalDelta).toBeNull();
  expect(comparison.quantityChanges.find(change=>change.before?.kind==='wall')?.delta).toBeNull();
  expect(comparison.issues.join(' ')).toMatch(/currency changed/);
 });
 it('shows holiday-driven schedule changes and preserves infeasibility as unknown',()=>{
  const before=fixture(),after=structuredClone(before);after.schedule.holidays=['2026-11-03'];
  const comparison=compareRevisions(before,after);
  expect(comparison.schedule.calendarDaysDelta).toBeGreaterThan(0);
  expect(comparison.schedule.activityChanges.length).toBeGreaterThan(0);
  after.schedule.activities=[{id:'cycle',name:'Cycle',category:'wall',quantity:1,unit:'m²',productivity:1,minDuration:1,predecessors:['cycle'],crewDemand:1,maxCrews:1,leadTime:0}];
  expect(compareRevisions(before,after).schedule.calendarDaysDelta).toBeNull();
 });
});
