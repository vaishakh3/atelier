import {describe,it,expect} from 'vitest';
import {createBlankProject} from '../src/domain/seed';
import type {BimElement,Project} from '../src/domain/types';
import {emptyPlanningContext,resetPlanningApprovalForImport} from '../src/domain/planning';
import {projectSchema} from '../src/domain/schema';
import {assessPlanning} from '../src/engine/planningChecks';
import {localToWorld} from '../src/model/geometry';
const date='2026-10-24';
function fixture():Project{
 const p=createBlankProject('Independent site fixture'),planning=emptyPlanningContext();
 Object.assign(planning,{country:'India',region:'Test region',authority:'Test municipality',authorityType:'municipality',plot:{x:0,y:0,width:20,depth:30,rotation:0},groundElevation:0,northAngle:0});
 planning.ruleSource={title:'TEST LIMITS — not actual law',url:'https://example.gov.test/fixture',version:'fixture-v1',country:planning.country,region:planning.region,authority:planning.authority,authorityType:'municipality',effectiveFrom:'2026-01-01',reviewedOn:date,applicability:'Synthetic single-family fixture only',confirmedBy:'QA reviewer',amendmentsChecked:true};
 planning.rules=[{id:'front',metric:'front-setback',limit:3,clause:'TEST FRONT'}, {id:'rear',metric:'rear-setback',limit:3,clause:'TEST REAR'}, {id:'coverage',metric:'coverage',limit:50,clause:'TEST COVERAGE'}, {id:'far',metric:'floor-area-ratio',limit:1,clause:'TEST FAR'}, {id:'height',metric:'height',limit:10,clause:'TEST HEIGHT'}];
 const slab:BimElement={id:'slab',kind:'slab',name:'Measured slab',levelId:p.levels[0].id,typeId:'slab-type',material:'Concrete',x:2,y:4,z:0,width:10,depth:12,height:.2,rotation:0,editable:true,properties:{}};
 return{...p,planning,elements:[slab]};
}
describe('Preliminary site measurements and entered limits',()=>{
 it('keeps old projects valid and every unconfigured legal check unevaluated',()=>{
  const p=createBlankProject('Old model');expect(projectSchema.safeParse(p).success).toBe(true);
  const report=assessPlanning(p,date);expect(report.legalStatus).toBe('not-configured');expect(report.checks).toHaveLength(8);expect(report.checks.every(c=>c.status==='not-evaluated')).toBe(true);expect(report.disclaimer).toMatch(/not legal compliance certification/);
 });
 it('measures clear plot-relative setbacks, slab union and above-ground model height without mutation',()=>{
  const p=fixture(),before=structuredClone(p),report=assessPlanning(p,date);
  expect(report.checks.find(c=>c.id==='front-setback')).toMatchObject({actual:4,status:'within-entered-limit',limit:3});
  expect(report.checks.find(c=>c.id==='rear-setback')).toMatchObject({actual:14});
  expect(report.checks.find(c=>c.id==='coverage')).toMatchObject({actual:20,status:'within-entered-limit'});
  expect(report.checks.find(c=>c.id==='floor-area-ratio')?.actual).toBe(.2);
  expect(report.checks.find(c=>c.id==='height')?.actual).toBe(.2);expect(p).toEqual(before);
 });
 it('rotates both the plot and model without changing the measured clearances',()=>{
  const p=fixture(),plot={...p.planning!.plot!,x:100,y:-30,rotation:90};p.planning!.plot=plot;
  p.elements=p.elements.map(e=>({...e,...localToWorld(plot,e.x,e.y),rotation:e.rotation+90}));
  const report=assessPlanning(p,date);expect(report.checks.find(c=>c.id==='front-setback')?.actual).toBe(4);expect(report.checks.find(c=>c.id==='coverage')?.actual).toBe(20);
 });
 it('changes front/left/right correctly with the road-facing boundary',()=>{
  const p=fixture();p.planning!.frontBoundary='east';const r=assessPlanning(p,date);
  expect(r.checks.find(c=>c.id==='front-setback')?.actual).toBe(8);expect(r.checks.find(c=>c.id==='left-setback')?.actual).toBe(4);expect(r.checks.find(c=>c.id==='right-setback')?.actual).toBe(14);
 });
 it('flags a real outside limit and lists source objects',()=>{
  const p=fixture();p.elements[0].y=1;const check=assessPlanning(p,date).checks[0];expect(check.status).toBe('outside-entered-limit');expect(check.actual).toBe(1);expect(check.elementIds).toEqual(['slab']);
 });
 it('does not double-count overlapping slab pieces and preserves actual upper voids',()=>{
  const p=fixture();p.levels.push({id:'upper',name:'Upper',elevation:3.2});p.elements.push({...p.elements[0],id:'overlap',x:7,width:5},{...p.elements[0],id:'upper-left',levelId:'upper',z:3.2,width:4},{...p.elements[0],id:'upper-right',levelId:'upper',z:3.2,x:8,width:4});
  const report=assessPlanning(p,date);expect(report.checks.find(c=>c.id==='coverage')?.actual).toBe(20);expect(report.checks.find(c=>c.id==='floor-area-ratio')?.actual).toBe(.36);
 });
 it('does not pass area limits using only ground geometry when another represented floor has no slab',()=>{
  const p=fixture();p.levels.push({id:'upper',name:'Upper',elevation:3.2});p.elements.push({...p.elements[0],id:'upper-wall',kind:'wall',levelId:'upper',z:3.2,depth:.2,height:2.8});
  const before=structuredClone(p),report=assessPlanning(p,date);
  for(const metric of ['coverage','floor-area-ratio'])expect(report.checks.find(check=>check.id===metric)).toMatchObject({actual:null,status:'not-evaluated'});
  expect(report.checks.find(check=>check.id==='storeys')?.actual).toBe(2);expect(report.checks.find(check=>check.id==='height')?.actual).toBe(6);expect(p).toEqual(before);
  p.elements.push({...p.elements[0],id:'upper-slab',levelId:'upper',z:3.2});expect(assessPlanning(p,date).checks.find(check=>check.id==='floor-area-ratio')).toMatchObject({actual:.4,status:'within-entered-limit'});
 });
 it('excludes roof-only levels from represented floor counts and does not treat missing levels as area',()=>{
  const p=fixture();p.planning!.rules.push({id:'storeys',metric:'storeys',limit:1,clause:'TEST MODEL FLOOR COUNT'});p.levels.push({id:'roof',name:'Roof',elevation:3.2});p.elements.push({...p.elements[0],id:'roof-element',kind:'roof',levelId:'roof',z:3.2});
  expect(assessPlanning(p,date).checks.find(check=>check.id==='storeys')).toMatchObject({actual:1,status:'within-entered-limit'});
  p.elements[1].levelId='missing-level';expect(assessPlanning(p,date).checks.every(check=>check.status==='not-evaluated')).toBe(true);
 });
 it('leaves plot-dependent measures unknown if no plot, and height unknown without a ground datum',()=>{
  const p=fixture();p.planning!.plot=null;p.planning!.groundElevation=null;const r=assessPlanning(p,date);expect(r.checks.find(c=>c.id==='coverage')).toMatchObject({status:'not-evaluated',actual:null});expect(r.checks.find(c=>c.id==='height')).toMatchObject({status:'not-evaluated',actual:null});
 });
 it.each(['mismatched','future','expired','missing-clause']as const)('does not pass rules with %s source evidence',problem=>{
  const p=fixture();if(problem==='mismatched')p.planning!.ruleSource.authority='Other council';if(problem==='future')p.planning!.ruleSource.effectiveFrom='2027-01-01';if(problem==='expired')p.planning!.ruleSource.reviewedOn='2024-01-01';if(problem==='missing-clause')p.planning!.rules.forEach(r=>r.clause='');
  const r=assessPlanning(p,date);expect(r.checks.every(c=>c.status==='not-evaluated')).toBe(true);
 });
 it('does not establish area or envelope compliance from unsupported references/rotations',()=>{
  const p=fixture();p.elements[0].rotation=30;expect(assessPlanning(p,date).checks.find(c=>c.id==='coverage')?.status).toBe('not-evaluated');
  p.elements.push({...p.elements[0],id:'ref',kind:'reference'});expect(assessPlanning(p,date).checks.every(c=>c.status==='not-evaluated')).toBe(true);
 });
 it('rejects duplicate metrics, invalid dates, unsafe source URLs and malformed saved planning input',()=>{
  const p=fixture();p.planning!.rules.push({...p.planning!.rules[0],id:'duplicate'});expect(projectSchema.safeParse(p).success).toBe(false);
  p.planning=fixture().planning;p.planning!.ruleSource.url='javascript:alert(1)';expect(projectSchema.safeParse(p).success).toBe(false);
  p.planning=fixture().planning;p.planning!.ruleSource.reviewedOn='2026-02-30';expect(projectSchema.safeParse(p).success).toBe(false);
 });
 it('retains imported site inputs for review but cannot reuse their former applicability approval',()=>{
  const p=fixture(),before=structuredClone(p.planning!);p.planning=resetPlanningApprovalForImport(p.planning!);
  expect(p.planning).toEqual({...before,ruleSource:{...before.ruleSource,amendmentsChecked:false,confirmedBy:''}});
  expect(before.ruleSource.amendmentsChecked).toBe(true);expect(before.ruleSource.confirmedBy).toBe('QA reviewer');expect(p.planning.plot).toEqual(before.plot);expect(p.planning.northAngle).toBe(before.northAngle);
  expect(assessPlanning(p,date).checks.every(check=>check.status==='not-evaluated')).toBe(true);
 });
});
describe('Client-selected Vaastu preferences',()=>{
 function kitchen(){const p=fixture();p.elements.push({...p.elements[0],id:'kitchen',kind:'room',name:'Kitchen',x:14,y:2,width:2,depth:2,height:.02,properties:{use:'kitchen'}});p.planning!.vaastu={enabled:true,preferences:[{id:'kitchen-se',target:'kitchen',mode:'prefer',sectors:['SE']}]};return p;}
 it('uses true north and measured room centres, with independent advisory statuses',()=>{
  const p=kitchen();const r=assessPlanning(p,date);expect(r.vaastu[0]).toMatchObject({sector:'SE',status:'matches-preference',elementIds:['kitchen']});expect(r.disclaimer).toMatch(/optional user-selected preferences/);
  p.planning!.northAngle=90;expect(assessPlanning(p,date).vaastu[0]).toMatchObject({sector:'SW',status:'conflicts-with-preference'});
 });
 it('handles avoided sectors, central spaces, missing north and untagged rooms honestly',()=>{
  const p=kitchen();p.planning!.vaastu.preferences[0].mode='avoid';expect(assessPlanning(p,date).vaastu[0].status).toBe('conflicts-with-preference');
  Object.assign(p.elements[1],{x:9,y:14});expect(assessPlanning(p,date).vaastu[0].sector).toBe('centre');
  p.planning!.northAngle=null;expect(assessPlanning(p,date).vaastu[0].status).toBe('not-evaluated');
  p.elements[1].properties={};expect(assessPlanning(p,date).vaastu[0]).toMatchObject({status:'not-evaluated',elementIds:[]});
 });
 it('disables Vaastu independently of building rules and survives saved-project validation',()=>{
  const p=kitchen();p.planning!.vaastu.enabled=false;const saved=projectSchema.parse(p);expect(assessPlanning(saved,date).vaastu).toEqual([]);expect(saved.planning!.ruleSource.version).toBe('fixture-v1');
 });
 it('normalizes equivalent negative/full-turn north angles before preferred and avoided-sector checks',()=>{
  const p=kitchen();Object.assign(p.elements[1],{x:1,y:14});p.planning!.vaastu.preferences[0]={id:'west',target:'kitchen',mode:'avoid',sectors:['W']};
  const zero=assessPlanning(p,date).vaastu[0];expect(zero).toMatchObject({sector:'W',status:'conflicts-with-preference'});
  for(const angle of [-360,360]){p.planning!.northAngle=angle;expect(assessPlanning(p,date).vaastu[0]).toMatchObject({sector:zero.sector,status:zero.status});}
  p.planning!.northAngle=-90;expect(assessPlanning(p,date).vaastu[0]).toMatchObject({sector:'S',status:'matches-preference'});
 });
});
