import {describe,expect,it} from 'vitest';
import {createBlankProject,createDemoProject} from '../src/domain/seed';
import {projectSchema} from '../src/domain/schema';
import {buildSchedule,generateActivities,scheduleActivitySignature,scheduleModelSignature} from '../src/engine/schedule';
import {compareScenarios,sequenceBaselineSignature} from '../src/engine/scenarios';
import {acceptScheduleRefresh,invalidateScheduleReview,previewModelImpact,previewScheduleRefresh} from '../src/engine/modelImpact';

function fixture(){const p=createDemoProject();p.schedule.activities=generateActivities(p);for(const allowance of p.allowances)if(allowance.amount===null)allowance.amount=1000;return p;}

describe('reviewed model-to-construction scope',()=>{
  it('marks a geometry revision without silently overwriting planner tasks, quantities, constraints or approvals',()=>{
    const before=fixture();before.schedule.activities.find(a=>a.id==='foundations')!.quantity=333;
    before.schedule.activities.find(a=>a.id==='walls')!.predecessors=['site'];
    const after=structuredClone(before);after.elements.find(e=>e.kind==='wall')!.width+=1;
    const pending=invalidateScheduleReview(before,after);
    expect(pending.schedule.modelReviewRequired).toBe(true);expect(pending.schedule.activities).toEqual(before.schedule.activities);expect(pending.constraints).toEqual(before.constraints);
    expect(buildSchedule(pending)).toMatchObject({feasible:false,durationDays:0});
    expect(compareScenarios(pending,'tradeoffs').every(scenario=>!scenario.feasible)).toBe(true);
    const refresh=previewScheduleRefresh(pending,before),next=acceptScheduleRefresh(pending,refresh,'editor');
    expect(next.schedule.activities.find(a=>a.id==='foundations')!.quantity).toBe(333);
    expect(next.schedule.activities.find(a=>a.id==='walls')!.predecessors).toEqual(['site']);
    expect(next.schedule.startDate).toBe(before.schedule.startDate);expect(next.schedule.workingDays).toEqual(before.schedule.workingDays);
    expect(buildSchedule(next).feasible).toBe(true);expect(next.schedule.modelReviewRequired).toBe(false);
    expect(before.schedule.modelReview).toBeUndefined();expect(after.schedule.modelReviewRequired).toBeUndefined();
  });
  it('records exact quantity/source changes and preserves manual quantity, productivity and fixed-duration overrides',()=>{
    const before=fixture(),after=structuredClone(before),walls=after.schedule.activities.find(a=>a.id==='walls')!;
    walls.quantityMode='manual';walls.quantity=741;walls.productivityMode='manual';walls.productivity=12;walls.fixedDuration=8;
    after.elements.push({...after.elements.find(e=>e.kind==='wall')!,id:'added-wall',hostId:undefined,x:25});
    const preview=previewScheduleRefresh(invalidateScheduleReview(before,after),before),change=preview.changes.find(c=>c.activityId==='walls')!;
    expect(change.afterSourceIds).toContain('added-wall');expect(change.beforeSourceIds).not.toContain('added-wall');
    expect(change.after).toMatchObject({quantityMode:'manual',quantity:741,productivityMode:'manual',productivity:12,fixedDuration:8});
    expect(change.reasons.join(' ')).toMatch(/Manual quantity retained exactly/);
  });
  it('proposes missing stair work with exact IDs instead of presenting a complete network without it',()=>{
    const before=fixture();before.elements=before.elements.filter(e=>e.kind!=='stair');before.schedule.activities=generateActivities(before);
    const after=structuredClone(before);after.elements.push({...createDemoProject().elements.find(e=>e.kind==='stair')!,id:'new-stair'});
    const impact=previewModelImpact(before,after),added=impact.scheduleRefresh.changes.find(c=>c.after?.category==='stair')!;
    expect(impact.scheduleRefresh.required).toBe(true);expect(impact.afterSchedule.feasible).toBe(false);
    expect(added.before).toBeNull();expect(added.afterSourceIds).toEqual(['new-stair']);expect(added.after?.quantity).toBe(1);
    expect(impact.reviewedAfterSchedule.feasible).toBe(true);expect(impact.reviewedAfterSchedule.activities.some(a=>a.category==='stair')).toBe(true);
    expect(typeof impact.scheduleDeltaDays).toBe('number');
  });
  it('fails stale explicit sources rather than resolving removed work to a zero quantity',()=>{
    const before=fixture(),walls=before.schedule.activities.find(a=>a.id==='walls')!;walls.sourceElementIds=['wall-n-00'];
    const after=structuredClone(before);after.elements=after.elements.filter(e=>e.id!=='wall-n-00');
    expect(buildSchedule(after).feasible).toBe(false);expect(buildSchedule(after).issues.join(' ')).toMatch(/stale.*missing work is not zero work/);
    const pending=invalidateScheduleReview(before,after),review=previewScheduleRefresh(pending,before),change=review.changes.find(c=>c.activityId==='walls')!;
    expect(review.staleSourceIds).toEqual(['wall-n-00']);expect(change.beforeSourceIds).toEqual(['wall-n-00']);
    expect(change.afterSourceIds.length).toBeGreaterThan(1);expect(change.reasons.join(' ')).toMatch(/every current element/);
  });
  it('does not infer new source selections for multiple work zones or manual task quantities',()=>{
    const p=fixture(),walls=p.schedule.activities.find(a=>a.id==='walls')!;walls.sourceElementIds=['missing-wall'];
    p.schedule.activities.push({...walls,id:'zone-two',sourceElementIds:['wall-s-00']});
    let review=previewScheduleRefresh(p);expect(review.canAccept).toBe(false);expect(()=>acceptScheduleRefresh(p,review,'admin')).toThrow(/cannot be safely reassigned/);
    p.schedule.activities=p.schedule.activities.filter(a=>a.id!=='zone-two');walls.quantityMode='manual';
    review=previewScheduleRefresh(p);expect(review.canAccept).toBe(false);expect(review.activities.find(a=>a.id==='walls')!.quantity).toBe(walls.quantity);
  });
  it('removes only obsolete model-linked selected tasks and keeps their prerequisite chain',()=>{
    const p=fixture();p.elements=p.elements.filter(e=>e.kind!=='stair');
    const stair=p.schedule.activities.find(a=>a.id==='stairs')!;stair.sourceElementIds=['removed-stair'];stair.predecessors=['structure'];
    const walls=p.schedule.activities.find(a=>a.id==='walls')!;walls.predecessors=['stairs'];
    const review=previewScheduleRefresh(p),change=review.changes.find(c=>c.activityId==='stairs')!;
    expect(change.after).toBeNull();expect(review.activities.find(a=>a.id==='walls')!.predecessors).toEqual(['structure']);
    expect(review.activities.some(a=>a.id==='stairs')).toBe(false);
  });
  it('expires sequencing approvals explicitly while retaining their rationale and dependency alternatives',()=>{
    const before=fixture();before.schedule.sequenceAlternatives=[{id:'parallel',name:'Work fronts',approved:true,rationale:'Separate working zones approved by planner',baselineSignature:sequenceBaselineSignature(before),predecessors:{walls:['site']}}];
    const after=structuredClone(before);after.elements.push({...after.elements.find(e=>e.kind==='stair')!,id:'second-stair',x:30});
    const pending=invalidateScheduleReview(before,after),review=previewScheduleRefresh(pending,before),next=acceptScheduleRefresh(pending,review,'editor');
    expect(review.invalidatedSequenceIds).toEqual(['parallel']);expect(next.schedule.sequenceAlternatives![0]).toMatchObject({approved:false,rationale:before.schedule.sequenceAlternatives![0].rationale,predecessors:{walls:['site']}});
    expect(before.schedule.sequenceAlternatives![0].approved).toBe(true);
  });
  it('rejects stale or tampered review acceptance, reviewer role, and activity locks',()=>{
    const p=fixture(),review=previewScheduleRefresh(p);
    expect(()=>acceptScheduleRefresh(p,review,'reviewer')).toThrow(/Reviewers/);
    const tampered=structuredClone(review);tampered.activities[0].quantity=999;
    expect(()=>acceptScheduleRefresh(p,tampered,'admin')).toThrow(/changed while/);
    p.elements[0].width+=1;expect(()=>acceptScheduleRefresh(p,review,'admin')).toThrow(/changed while/);
    p.constraints.lockedProperties=['schedule.activities.walls.quantity'];
    const locked=previewScheduleRefresh(p);expect(locked.canAccept).toBe(false);expect(()=>acceptScheduleRefresh(p,locked,'admin')).toThrow(/locked/);
  });
  it('detects changed reviewed model and network signatures without relying on a transient UI flag',()=>{
    const p=fixture(),reviewed=acceptScheduleRefresh(p,previewScheduleRefresh(p),'editor');
    expect(reviewed.schedule.modelReview).toMatchObject({modelSignature:scheduleModelSignature(reviewed),activitySignature:scheduleActivitySignature(reviewed.schedule.activities)});
    reviewed.elements[0].width+=1;expect(buildSchedule(reviewed).feasible).toBe(false);
    const repaired=acceptScheduleRefresh(reviewed,previewScheduleRefresh(reviewed),'editor');repaired.schedule.activities[0].predecessors=['walls'];
    expect(buildSchedule(repaired).feasible).toBe(false);
  });
  it('retains review validity after schema canonicalisation and persisted JSON round trips',()=>{
    const p=fixture();p.schedule.activities[0]={...p.schedule.activities[0],quantityMode:'manual',productivityMode:'manual',fixedDuration:2};
    const reviewed=acceptScheduleRefresh(p,previewScheduleRefresh(p),'editor');
    const canonical=projectSchema.parse(JSON.parse(JSON.stringify(reviewed))) as typeof reviewed;
    expect(scheduleActivitySignature(canonical.schedule.activities)).toBe(reviewed.schedule.modelReview!.activitySignature);
    expect(buildSchedule(canonical).feasible).toBe(true);expect(buildSchedule(canonical).durationDays).toBe(buildSchedule(reviewed).durationDays);
    const reversed=canonical.schedule.activities.map(activity=>Object.fromEntries(Object.entries(activity).reverse()) as typeof activity);
    expect(scheduleActivitySignature(reversed)).toBe(scheduleActivitySignature(reviewed.schedule.activities));
    canonical.schedule.activities[0].fixedDuration=3;expect(buildSchedule(canonical).feasible).toBe(false);
  });
  it('keeps missing rates unknown and exposes unresolved time as null while comparing without mutation',()=>{
    const before=fixture(),after=structuredClone(before);after.types.find(type=>type.kind==='wall')!.materialRate=null;after.elements[0].width+=1;
    const original=JSON.stringify([before,after]),impact=previewModelImpact(before,after);
    expect(impact.reviewedAfterCost.completeness).toBeLessThan(100);expect(impact.issues.join(' ')).toMatch(/missing rates.*not savings/i);expect(JSON.stringify([before,after])).toBe(original);
    const blank=createBlankProject('Empty');expect(buildSchedule(blank).feasible).toBe(false);expect(previewModelImpact(blank,after).scheduleDeltaDays).toBeNull();
  });
  it('does not invalidate work scope for cosmetic labels, unit preferences or rate changes',()=>{
    const before=fixture(),after=structuredClone(before);after.name='Renamed';after.elements[0].name='New label';after.currency='USD';after.units='ft';after.types[0].materialRate=42;
    expect(invalidateScheduleReview(before,after)).toBe(after);expect(scheduleModelSignature(before)).toBe(scheduleModelSignature(after));
    after.types[0].productivity+=1;expect(invalidateScheduleReview(before,after).schedule.modelReviewRequired).toBe(true);
  });
  it('retains legacy manual-network scheduling behavior until a model revision explicitly needs review',()=>{
    const p=fixture();p.schedule.activities=[{id:'manual',name:'Entered scope only',category:'allowance',quantity:1,unit:'item',productivity:1,minDuration:1,predecessors:[],crewDemand:1,maxCrews:1,leadTime:0,fixedDuration:3}];
    expect(buildSchedule(p)).toMatchObject({feasible:true,workingDays:3});
    const changed=structuredClone(p);changed.elements[0].width+=1;expect(buildSchedule(invalidateScheduleReview(p,changed)).feasible).toBe(false);
  });
  it('preserves pending review when an identical-model replacement drops its review metadata',()=>{
    const before=fixture();before.schedule.modelReviewRequired=true;
    const after=structuredClone(before);delete after.schedule.modelReviewRequired;delete after.schedule.modelReview;
    expect(invalidateScheduleReview(before,after).schedule.modelReviewRequired).toBe(true);
    const reviewed=acceptScheduleRefresh(after,previewScheduleRefresh(after),'editor');
    expect(invalidateScheduleReview(before,reviewed)).toBe(reviewed);expect(buildSchedule(reviewed).feasible).toBe(true);
    const withoutStamp=structuredClone(reviewed);delete withoutStamp.schedule.modelReview;
    expect(invalidateScheduleReview(reviewed,withoutStamp).schedule.modelReviewRequired).toBe(true);
    const pendingExact=structuredClone(reviewed);pendingExact.schedule.modelReviewRequired=true;
    const onlyClearedFlag=structuredClone(pendingExact);onlyClearedFlag.schedule.modelReviewRequired=false;
    expect(invalidateScheduleReview(pendingExact,onlyClearedFlag).schedule.modelReviewRequired).toBe(true);
    const newlyReviewed=structuredClone(onlyClearedFlag);newlyReviewed.schedule.modelReview!.acceptedAt='2030-01-01T00:00:00Z';
    expect(invalidateScheduleReview(pendingExact,newlyReviewed)).toBe(newlyReviewed);
  });
  it('permits restoring a coherent exact reviewed model/network snapshot from an unreviewed revision',()=>{
    const prior=fixture(),reviewed=acceptScheduleRefresh(prior,previewScheduleRefresh(prior),'editor'),later=structuredClone(reviewed);later.elements[0].width+=1;later.schedule.modelReviewRequired=true;
    expect(invalidateScheduleReview(later,reviewed)).toBe(reviewed);expect(buildSchedule(reviewed).feasible).toBe(true);
  });
});
