import type {ActivityDefinition, CostResult, ElementKind, Project, Role, ScheduleResult} from '../domain/types';
import {estimate} from './cost';
import {buildSchedule,generateActivities,resolveModelQuantity,scheduleActivitySignature,scheduleModelSignature,scheduleReviewIsCurrent} from './schedule';
import {sequenceBaselineSignature} from './scenarios';

export interface ActivityScopeChange {
  activityId:string;
  before:ActivityDefinition|null;
  after:ActivityDefinition|null;
  beforeSourceIds:string[];
  afterSourceIds:string[];
  reasons:string[];
}
export interface ScheduleRefreshPreview {
  required:boolean;
  beforeSignature:string;
  afterSignature:string;
  modelSignature:string;
  reviewSignature:string;
  activities:ActivityDefinition[];
  changes:ActivityScopeChange[];
  staleSourceIds:string[];
  uncoveredElementIds:string[];
  invalidatedSequenceIds:string[];
  issues:string[];
  blockingIssues:string[];
  canAccept:boolean;
}
export interface ModelImpactPreview {
  beforeCost:CostResult;
  afterCost:CostResult;
  beforeSchedule:ScheduleResult;
  afterSchedule:ScheduleResult;
  reviewedAfterCost:CostResult;
  reviewedAfterSchedule:ScheduleResult;
  costDelta:number;
  scheduleDeltaDays:number|null;
  scheduleRefresh:ScheduleRefreshPreview;
  issues:string[];
}

const kinds:ElementKind[]=['slab','wall','roof','window','door','stair'];
const unique=(ids:string[])=>[...new Set(ids)].sort();
const sourceIds=(project:Project,activity:ActivityDefinition)=>unique(project.elements.filter(element=>element.kind===activity.category&&(!activity.sourceElementIds||activity.sourceElementIds.includes(element.id))).map(element=>element.id));
const reviewSourceIds=(project:Project,activity:ActivityDefinition)=>activity.sourceElementIds?unique(activity.sourceElementIds):sourceIds(project,activity);
const definitions=(project:Project)=>project.schedule.activities.length?structuredClone(project.schedule.activities):generateActivities(project);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const scopeSignature=(project:Project)=>JSON.stringify(kinds.map(kind=>[kind,project.elements.filter(element=>element.kind===kind).map(element=>element.id).sort()]));

function scheduleLocks(project:Project):boolean {
  return project.constraints.lockedProperties.some(key=>key==='*'||key==='schedule'||key==='schedule.*'||key==='activities'||key==='schedule.activities'||key.startsWith('schedule.activities.')||key.startsWith('activities.')||key==='predecessors'||key==='schedule.predecessors');
}

/** Mark a model revision without replacing planner activities, quantities, sequence approvals or settings. */
export function invalidateScheduleReview(before:Project,after:Project):Project {
  // A complete, exact reviewed snapshot (or explicit scope acceptance) is coherent in its own right.
  const modelChanged=scheduleModelSignature(before)!==scheduleModelSignature(after);
  const beforeReview=before.schedule.modelReview,afterReview=after.schedule.modelReview;
  const sameReview=Boolean(beforeReview&&afterReview&&beforeReview.acceptedAt===afterReview.acceptedAt&&beforeReview.modelSignature===afterReview.modelSignature&&beforeReview.activitySignature===afterReview.activitySignature);
  const reusedPendingStamp=before.schedule.modelReviewRequired&&sameReview&&!modelChanged&&scheduleActivitySignature(definitions(before))===scheduleActivitySignature(definitions(after));
  if(afterReview&&scheduleReviewIsCurrent(after)&&!reusedPendingStamp)return after;
  const pending=before.schedule.modelReviewRequired||Boolean(before.schedule.modelReview&&!scheduleReviewIsCurrent(before));
  const removedReview=Boolean(before.schedule.modelReview&&!after.schedule.modelReview);
  if(modelChanged||pending||removedReview)return{...after,schedule:{...after.schedule,modelReviewRequired:true}};
  return after;
}

/** A deterministic proposal only. Manual quantities and all existing task settings remain planner-owned. */
export function previewScheduleRefresh(project:Project,baseline:Project=project):ScheduleRefreshPreview {
  const original=definitions(project),activities=structuredClone(original),issues:string[]=[],blockingIssues:string[]=[];
  const reasons=new Map<string,string[]>();
  const note=(id:string,text:string)=>reasons.set(id,[...(reasons.get(id)??[]),text]);
  const staleSourceIds=unique(original.flatMap(activity=>(activity.sourceElementIds??[]).filter(id=>!project.elements.some(element=>element.id===id))));
  const removed=new Map<string,ActivityDefinition>();
  for(const activity of activities) {
    const missing=(activity.sourceElementIds??[]).filter(id=>!project.elements.some(element=>element.id===id));
    if(missing.length) {
      const peers=activities.filter(other=>other.category===activity.category);
      if(activity.quantityMode!=='model'||peers.length!==1) {
        blockingIssues.push(`${activity.name}: removed source IDs ${missing.join(', ')} cannot be safely reassigned across planner-owned or multiple work packages. Edit its source IDs before accepting this review.`);
      } else {
        const live=sourceIds(project,{...activity,sourceElementIds:undefined});
        if(live.length){activity.sourceElementIds=live;note(activity.id,'Proposed replacement of stale selection with every current element in this category. Review the listed IDs and any work-zone assumptions.');}
        else {removed.set(activity.id,structuredClone(activity));note(activity.id,'No source elements remain. Propose removing this model-linked task and retaining its prerequisite chain in dependent tasks.');}
      }
    }
    if(activity.quantityMode==='model'&&!removed.has(activity.id)) {
      const measured=resolveModelQuantity(project,activity);
      issues.push(...measured.issues);
      if(measured.error)blockingIssues.push(measured.error);
      else {if(activity.quantity!==measured.quantity)note(activity.id,'Quantity recalculated from the listed live model sources.');activity.quantity=measured.quantity;}
    } else if(!removed.has(activity.id))note(activity.id,project.schedule.activities.length?'Manual quantity retained exactly. Confirm this work package and any unmodelled/proxy scope against the revised design.':'Preliminary manual/proxy quantity generated for the first construction plan. Confirm the work scope and quantity before accepting.');
  }
  // Removal is reviewable and preserves transitive prerequisites. It never removes manual tasks.
  const expand=(id:string,seen=new Set<string>()):string[]=>{
    if(!removed.has(id))return[id];
    if(seen.has(id)){blockingIssues.push('Cannot remove obsolete model tasks because their prerequisite chain has a cycle.');return[];}
    return removed.get(id)!.predecessors.flatMap(parent=>expand(parent,new Set([...seen,id])));
  };
  let proposed=activities.filter(activity=>!removed.has(activity.id)).map(activity=>{
    const predecessors=unique(activity.predecessors.flatMap(id=>expand(id)));
    if(!same(unique(activity.predecessors),predecessors))note(activity.id,'Replaced removed model task prerequisites with their original prerequisites.');
    return{...activity,predecessors};
  });
  const covered=new Set(proposed.flatMap(activity=>sourceIds(project,activity)));
  const uncoveredElementIds=project.elements.filter(element=>kinds.includes(element.kind)&&!covered.has(element.id)).map(element=>element.id).sort();
  const defaults=generateActivities(project);
  for(const kind of kinds) {
    const ids=uncoveredElementIds.filter(id=>project.elements.find(element=>element.id===id)?.kind===kind);
    if(!ids.length)continue;
    const template=defaults.find(activity=>activity.category===kind&&activity.quantityMode==='model');
    if(!template){blockingIssues.push(`No supported construction activity rule for ${kind}; map ${ids.join(', ')} explicitly.`);continue;}
    let id=`model-${kind}`,suffix=2;while(proposed.some(activity=>activity.id===id))id=`model-${kind}-${suffix++}`;
    const predecessors=template.predecessors.filter(parent=>proposed.some(activity=>activity.id===parent));
    const activity:ActivityDefinition={...template,id,name:`${template.name} · added model scope`,predecessors,sourceElementIds:ids};
    const measured=resolveModelQuantity(project,activity);
    if(measured.error)blockingIssues.push(measured.error);else activity.quantity=measured.quantity;
    proposed.push(activity);note(id,'New model scope is absent from the existing work packages. Proposed quantity and preliminary prerequisites require planner review.');
  }
  proposed=proposed.map(activity=>({...activity,predecessors:[...activity.predecessors]}));
  const beforeSignature=scheduleActivitySignature(original),afterSignature=scheduleActivitySignature(proposed),modelSignature=scheduleModelSignature(project);
  const sourceChanged=scopeSignature(baseline)!==scopeSignature(project);
  const graphBefore=sequenceBaselineSignature({...project,schedule:{...project.schedule,activities:original}}),graphAfter=sequenceBaselineSignature({...project,schedule:{...project.schedule,activities:proposed}});
  const invalidatedSequenceIds=(project.schedule.sequenceAlternatives??[]).filter(alternative=>alternative.approved&&(alternative.baselineSignature!==graphAfter||graphBefore!==graphAfter||sourceChanged||project.schedule.modelReviewRequired)).map(alternative=>alternative.id);
  if(invalidatedSequenceIds.length)issues.push(`${invalidatedSequenceIds.length} approved sequencing alternative(s) need renewed approval after this scope/network review; their definitions and rationale will be retained.`);
  if(original.some(activity=>activity.quantityMode!=='model'))issues.push(project.schedule.activities.length?'Manual work quantities, fixed durations, crews, lead times and dependencies are retained. Accepting this review confirms you checked their scope; no foundation, services or finish quantity is silently resized.':'There is no stored activity network. The first proposed template includes provisional manual/proxy quantities, fixed durations, crew demands, lead times and dependencies. Confirm these new assumptions before accepting.');
  if(uncoveredElementIds.length)issues.push(`${uncoveredElementIds.length} model element(s) were absent from work packages. New proposed tasks cover their exact IDs; validate sequence and productivity before accepting.`);
  issues.push('This review covers represented model work and entered activities. Foundations, services, curing, inspections, finishes and other unmodelled scope still require planner input. It does not certify a complete construction programme.');
  const changes:ActivityScopeChange[]=unique([...original.map(activity=>activity.id),...proposed.map(activity=>activity.id)]).flatMap(id=>{
    const before=project.schedule.activities.length?original.find(activity=>activity.id===id)??null:null,after=proposed.find(activity=>activity.id===id)??null;
    const beforeSourceIds=before?reviewSourceIds(baseline,before):[],afterSourceIds=after?reviewSourceIds(project,after):[];
    if(same(before,after)&&same(beforeSourceIds,afterSourceIds)&&!reasons.has(id))return[];
    return[{activityId:id,before,after,beforeSourceIds,afterSourceIds,reasons:reasons.get(id)??['Model source membership changed.']}];
  });
  const activityFields=['quantity','unit','productivity','minDuration','predecessors','crewDemand','maxCrews','leadTime','fixedDuration','quantityMode','sourceElementIds','productivityMode'] as const;
  for(const change of changes)for(const field of activityFields) {
    if(same(change.before?.[field],change.after?.[field]))continue;
    const keys=[field,`schedule.${field}`,`${change.activityId}.*`,`${change.activityId}.${field}`,`activities.${change.activityId}.${field}`,`schedule.activities.${change.activityId}.${field}`];
    if(project.constraints.lockedProperties.some(key=>keys.includes(key)))blockingIssues.push(`${change.after?.name??change.before?.name}: ${field} is locked by project constraints.`);
  }
  const required=Boolean(project.schedule.modelReviewRequired||project.schedule.modelReview&&(project.schedule.modelReview.modelSignature!==modelSignature||project.schedule.modelReview.activitySignature!==beforeSignature)||staleSourceIds.length||scheduleModelSignature(baseline)!==modelSignature);
  if(scheduleLocks(project))blockingIssues.push('Construction activities are locked by project constraints. Unlock them through the authorised project workflow before accepting a refresh.');
  const reviewSignature=JSON.stringify({schedule:project.schedule,constraints:project.constraints});
  return{required,beforeSignature,afterSignature,modelSignature,reviewSignature,activities:proposed,changes,staleSourceIds,uncoveredElementIds,invalidatedSequenceIds,issues:unique(issues),blockingIssues:unique(blockingIssues),canAccept:blockingIssues.length===0};
}

function reviewedProject(project:Project,preview:ScheduleRefreshPreview):Project {
  return{...project,schedule:{...project.schedule,activities:structuredClone(preview.activities),modelReviewRequired:false,modelReview:{modelSignature:preview.modelSignature,activitySignature:preview.afterSignature,acceptedAt:new Date().toISOString()},sequenceAlternatives:project.schedule.sequenceAlternatives?.map(alternative=>preview.invalidatedSequenceIds.includes(alternative.id)?{...alternative,approved:false}:alternative)}};
}

/** A caller must show this exact proposal first. Stale previews, reviewers and locked activities cannot commit it. */
export function acceptScheduleRefresh(project:Project,preview:ScheduleRefreshPreview,role:Role):Project {
  if(role==='reviewer')throw new Error('Reviewers cannot change construction planning activities.');
  const live=previewScheduleRefresh(project);
  if(preview.modelSignature!==live.modelSignature||preview.beforeSignature!==live.beforeSignature||preview.afterSignature!==live.afterSignature||preview.reviewSignature!==live.reviewSignature||!same(preview.activities,live.activities))throw new Error('The model or activity network changed while this review was open. Reopen the review before accepting.');
  if(!live.canAccept)throw new Error(live.blockingIssues.join(' '));
  const next=reviewedProject(project,live),schedule=buildSchedule(next);
  if(!schedule.feasible)throw new Error(`The proposed activity plan is not schedulable: ${schedule.issues.join(' ')}`);
  return next;
}

/** Compare known, represented scope without modifying either project or treating missing prices as savings. */
export function previewModelImpact(before:Project,after:Project):ModelImpactPreview {
  const beforeSchedule=buildSchedule(before),beforeCost=estimate(before,beforeSchedule);
  const pending=invalidateScheduleReview(before,after),afterSchedule=buildSchedule(pending),afterCost=estimate(pending,afterSchedule);
  const scheduleRefresh=previewScheduleRefresh(pending,before),projected=reviewedProject(pending,scheduleRefresh);
  const reviewedAfterSchedule=scheduleRefresh.canAccept?buildSchedule(projected):{...afterSchedule,feasible:false,issues:[...afterSchedule.issues,...scheduleRefresh.blockingIssues]};
  const reviewedAfterCost=estimate(projected,reviewedAfterSchedule);
  const issues=unique([...scheduleRefresh.issues,...scheduleRefresh.blockingIssues,...(!beforeSchedule.feasible?['The prior construction plan is unresolved; a defensible completion-time delta is unavailable.']:[]),...(reviewedAfterCost.completeness<100?['The proposed cost is a known subtotal; missing rates, allowances or unresolved time costs are not savings.']:[])]);
  return{beforeCost,afterCost,beforeSchedule,afterSchedule,reviewedAfterCost,reviewedAfterSchedule,costDelta:Math.round((reviewedAfterCost.total-beforeCost.total)*100)/100,scheduleDeltaDays:beforeSchedule.feasible&&reviewedAfterSchedule.feasible?reviewedAfterSchedule.durationDays-beforeSchedule.durationDays:null,scheduleRefresh,issues};
}
