import {describe,it,expect} from 'vitest';
import {emptyPlanningContext} from '../src/domain/planning';
import {keralaResidentialWorksheet} from '../src/domain/keralaRules';
import {assessPlanning,reviewedSiteEnvelope} from '../src/engine/planningChecks';
import {createBlankProject} from '../src/domain/seed';
import {projectSchema} from '../src/domain/schema';
function site(){return{...emptyPlanningContext(),authority:'Kochi Municipal Corporation',authorityType:'corporation'as const,plot:{x:-5,y:-5,width:30,depth:30,rotation:0},groundElevation:0};}
describe('Dated Kerala rule worksheets',()=>{
 it('selects the municipal source for corporations, clears approval and keeps height unconfigured',()=>{
  const inputs=site();inputs.ruleSource.confirmedBy='Old approval';const worksheet=keralaResidentialWorksheet(inputs);
  expect(worksheet.ruleSource.version).toContain('53/2025');expect(worksheet.ruleSource.amendmentsChecked).toBe(false);expect(worksheet.ruleSource.reviewedOn).toBe('');expect(worksheet.ruleSource.confirmedBy).toBe('');
  expect(worksheet.rules.find(r=>r.metric==='height')).toBeUndefined();expect(worksheet.rules.find(r=>r.metric==='coverage')?.limit).toBe(65);expect(worksheet.rules.find(r=>r.metric==='floor-area-ratio')?.limit).toBe(3);
  expect(projectSchema.safeParse({...createBlankProject('Worksheet'),planning:worksheet}).success).toBe(true);
 });
 it('requires an explicit panchayat notification category and selects its matching area limits',()=>{
  const input={...site(),authorityType:'panchayat'as const,authority:'QA Panchayat'};expect(()=>keralaResidentialWorksheet(input)).toThrow(/notified panchayat/);
  const a=keralaResidentialWorksheet({...input,panchayatCategory:'I'}),b=keralaResidentialWorksheet({...input,panchayatCategory:'II'});
  expect(a.ruleSource.version).toContain('54/2025');expect(a.rules.find(r=>r.metric==='coverage')?.limit).toBe(65);expect(b.rules.find(r=>r.metric==='coverage')?.limit).toBe(60);expect(b.rules.find(r=>r.metric==='floor-area-ratio')?.limit).toBe(2.5);
 });
 it('does not mark a loaded worksheet as evaluated before amendment/applicability review',()=>{
  const p={...createBlankProject('Unreviewed'),planning:keralaResidentialWorksheet(site())},r=assessPlanning(p,'2026-10-24');
  expect(r.checks.every(c=>c.status==='not-evaluated')).toBe(true);expect(r.coverageGaps.join(' ')).toMatch(/29 October 2025/);expect(reviewedSiteEnvelope(p)?.south).toBe(0);
 });
 it('uses ten metres only as applicability, rejects changed panchayat category and country',()=>{
  const planning=keralaResidentialWorksheet({...site(),authorityType:'panchayat',panchayatCategory:'I'});Object.assign(planning.ruleSource,{reviewedOn:'2026-10-24',confirmedBy:'Synthetic QA reviewer',amendmentsChecked:true});const p={...createBlankProject('Eligibility'),planning};
  expect(reviewedSiteEnvelope(p,'2026-10-24',6.2)?.south).toBe(3);expect(reviewedSiteEnvelope(p,'2026-10-24',11)?.south).toBe(0);
  p.planning.panchayatCategory='II';expect(reviewedSiteEnvelope(p,'2026-10-24',6.2)?.sourceReviewed).toBe(false);
  p.planning.panchayatCategory='I';p.planning.region='Other';p.planning.ruleSource.region='Other';expect(reviewedSiteEnvelope(p,'2026-10-24',6.2)?.sourceReviewed).toBe(false);
 });
 it('rejects a panchayat source retained after switching to a municipal authority',()=>{
  const planning=keralaResidentialWorksheet({...site(),authorityType:'panchayat',panchayatCategory:'II'});Object.assign(planning.ruleSource,{reviewedOn:'2026-10-24',confirmedBy:'Synthetic QA reviewer',amendmentsChecked:true});planning.authorityType='municipality';planning.ruleSource.authorityType='municipality';
  const p={...createBlankProject('Branch mismatch'),planning};expect(reviewedSiteEnvelope(p,'2026-10-24',6.2)?.sourceReviewed).toBe(false);expect(assessPlanning(p,'2026-10-24').sourceIssues.join(' ')).toMatch(/does not match.*branch/);
 });
});
