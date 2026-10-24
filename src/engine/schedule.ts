import type { ActivityDefinition, Project, ScheduleResult, ScheduledActivity } from '../domain/types';
import { quantities } from './quantities';
import {calculateServiceProgramme,serviceInstallationActivities} from '../services/calculations';
import {servicePlanIsCurrent} from '../services/model';

const DAY = 86_400_000;
const iso = (date:Date) => date.toISOString().slice(0, 10);
const isDate = (value:string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && iso(new Date(`${value}T00:00:00Z`)) === value;

/** Canonical source text, not a digital signature. Cosmetic labels and rates do not alter work scope. */
export function scheduleModelSignature(project:Project):string {
  return 'atelier-model-work-v1:'+JSON.stringify({
    levels:project.levels.map(({id,elevation})=>({id,elevation})).sort((a,b)=>a.id.localeCompare(b.id)),
    elements:project.elements.filter(element=>element.kind!=='reference').map(element=>({id:element.id,kind:element.kind,levelId:element.levelId,typeId:element.typeId,hostId:element.hostId??null,x:element.x,y:element.y,z:element.z,width:element.width,depth:element.depth,height:element.height,rotation:element.rotation,...(element.footprint?{footprint:element.footprint}:{})})).sort((a,b)=>a.id.localeCompare(b.id)),
    types:project.types.filter(type=>project.elements.some(element=>element.typeId===type.id)).map(({id,kind,unit,productivity})=>({id,kind,unit,productivity})).sort((a,b)=>a.id.localeCompare(b.id)),
    ...(project.services?{services:{modelSignature:project.services.modelSignature,points:project.services.points,routes:project.services.routes,productivity:project.services.assumptions.rates.map(({key,unit,productivity})=>({key,unit,productivity})).sort((a,b)=>a.key.localeCompare(b.key)),crews:project.services.assumptions.crews}}:{}),
  });
}

export function scheduleActivitySignature(activities:ActivityDefinition[]):string {
  return 'atelier-activity-review-v1:'+JSON.stringify(activities.map(activity=>({
    id:activity.id,category:activity.category,unit:activity.unit,
    quantityMode:activity.quantityMode??'manual',quantity:activity.quantityMode==='model'?null:activity.quantity,
    productivityMode:activity.productivityMode??'manual',productivity:activity.productivityMode==='type'?null:activity.productivity,
    minDuration:activity.minDuration,predecessors:[...activity.predecessors].sort(),crewDemand:activity.crewDemand,maxCrews:activity.maxCrews,leadTime:activity.leadTime,
    fixedDuration:activity.fixedDuration??null,sourceElementIds:activity.sourceElementIds?[...new Set(activity.sourceElementIds)].sort():null,
    ...(activity.servicePackage?{servicePackage:activity.servicePackage}:{}),
  })).sort((a,b)=>a.id.localeCompare(b.id)));
}

export function scheduleReviewIsCurrent(project:Project):boolean {
  const review=project.schedule.modelReview;
  return !project.schedule.modelReviewRequired&&(!review||(review.modelSignature===scheduleModelSignature(project)&&review.activitySignature===scheduleActivitySignature(project.schedule.activities.length?project.schedule.activities:generateActivities(project))));
}

/** For an explicitly reviewed, validated option only. A stale original cannot be legitimised by stamping its candidate. */
export function stampScheduleCandidate(baseline:Project,candidate:Project,acceptedAt=baseline.schedule.modelReview?.acceptedAt??baseline.updatedAt):Project {
  if(!scheduleReviewIsCurrent(baseline))return{...candidate,schedule:{...candidate.schedule,modelReviewRequired:true}};
  return{...candidate,schedule:{...candidate.schedule,modelReviewRequired:false,modelReview:{modelSignature:scheduleModelSignature(candidate),activitySignature:scheduleActivitySignature(candidate.schedule.activities.length?candidate.schedule.activities:generateActivities(candidate)),acceptedAt}}};
}

/** A deliberately preliminary low-rise network; every activity remains editable. */
export function generateActivities(project:Project):ActivityDefinition[] {
  const measured = quantities({...project,types:project.types.map(type=>({...type,unit:'m²'}))});
  const area = (kind:string) => measured.filter(line => line.kind === kind&&line.unit==='m²').reduce((sum,line)=>sum+line.quantity,0);
  const floorArea = area('slab') || area('room');
  const groundAreas = project.levels.map(level => project.elements.filter(element => element.kind === 'slab' && element.levelId === level.id).reduce((sum, element) => sum + element.width * element.depth, 0));
  const footprint = Math.max(1, ...groundAreas);
  const wallArea = area('wall');
  const windowCount = project.elements.filter(element => element.kind === 'window').length;
  const doorCount = project.elements.filter(element => element.kind === 'door').length;
  const serviceTasks=serviceInstallationActivities(project,['walls'],['internal-finishes']);
  const make = (id:string, name:string, category:ActivityDefinition['category'], quantity:number, unit:string, productivity:number, minDuration:number, predecessors:string[], leadTime = 0, fixedDuration?:number, quantityMode:'model'|'manual' = 'manual'):ActivityDefinition => ({ id, name, category, quantity, unit, productivity, minDuration, predecessors, crewDemand:1, maxCrews:1, leadTime, quantityMode, productivityMode:quantityMode === 'model' ? 'type' : 'manual', ...(fixedDuration !== undefined ? { fixedDuration } : {}) });
  return [
    make('site', 'Site setup & setting out', 'allowance', 1, 'scope item', 1, 2, [], 0, 2),
    make('foundations', 'Foundations — confirm engineering scope', 'allowance', footprint, 'm² footprint proxy', 25, 3, ['site']),
    make('structure', 'Slab construction — structural sequence to confirm', 'slab', area('slab'), 'm² floor area', 30, 3, ['foundations'], 0, undefined, 'model'),
    make('walls', 'Wall construction', 'wall', wallArea, 'm² net wall', 25, 2, ['structure'], 0, undefined, 'model'),
    ...(project.elements.some(element=>element.kind==='stair')?[make('stairs', 'Stair construction — confirm structural sequence', 'stair', project.elements.filter(element=>element.kind==='stair').length, 'ea', .5, 2, ['structure'], 0, undefined, 'model')]:[]),
    make('roof', 'Roof assembly', 'roof', area('roof'), 'm² plan area', 30, 2, ['walls'], 5, undefined, 'model'),
    make('openings', 'Windows installation', 'window', windowCount, 'ea', 6, 1, ['walls'], 10, undefined, 'model'),
    make('doors', 'Doors installation', 'door', doorCount, 'ea', 6, 1, ['walls'], 5, undefined, 'model'),
    ...(project.services?serviceTasks:[make('mep', 'Services rough-in — confirm specialist scope', 'allowance', floorArea || footprint, 'm² floor area proxy', 25, 3, ['walls'])]),
    make('internal-finishes', 'Internal finishes — confirm finish scope', 'room', floorArea + wallArea || footprint, 'm² finish proxy', 40, 3, ['roof', 'openings', 'doors',...(project.services?serviceTasks.filter(task=>task.servicePackage==='routes').map(task=>task.id):['mep'])]),
    make('external-finishes', 'External finishes & handover', 'allowance', wallArea || footprint, 'm² wall proxy', 35, 2, ['roof', 'openings', 'doors',...serviceTasks.filter(task=>task.servicePackage==='points').map(task=>task.id)]),
  ];
}

/** A selector is either all live elements in a category or an explicit deduplicated subset. */
export function resolveModelQuantity(project:Project, activity:ActivityDefinition):{ quantity:number; issues:string[]; error?:string } {
  const unit = (['m²', 'm³', 'ea', 'm'] as const).find(candidate => activity.unit === candidate || activity.unit.startsWith(`${candidate} `));
  if (activity.category === 'allowance' || activity.category === 'reference' || !unit) return { quantity:0, issues:[], error:`${activity.name}: no supported model measurement rule for ${activity.category} / ${activity.unit}; enter a manual quantity.` };
  const selected = activity.sourceElementIds ? new Set(activity.sourceElementIds) : null;
  const issues:string[] = [];
  if (selected) {
    const missing = [...selected].filter(id => !project.elements.some(element => element.id === id));
    if (missing.length) issues.push(`${activity.name}: ${missing.length} selected source element(s) no longer exist; removed from measured quantity.`);
    const mismatched = project.elements.filter(element => selected.has(element.id) && element.kind !== activity.category);
    if (mismatched.length) issues.push(`${activity.name}: ${mismatched.length} selected source element(s) do not match ${activity.category}; excluded.`);
  }
  // Keep all host geometry for opening deductions; change only measurement units, never canonical model data.
  const measured = quantities({ ...project, types:project.types.map(type => ({ ...type, unit })) });
  const matches = measured.filter(line => line.kind === activity.category && (!selected || selected.has(line.elementId)));
  const invalid = matches.find(line => line.issues.some(issue => /must be positive|negative or non-finite|exceed gross|overlap|outside host|not aligned|same level|invalid opening|no valid|Invalid measurement/.test(issue)));
  if (invalid) return { quantity:0, issues, error:`${activity.name}: invalid source geometry (${invalid.name}); correct model dimensions before scheduling.` };
  const incompatible = matches.find(line => line.unit !== unit);
  if (incompatible) return { quantity:0, issues, error:`${activity.name}: ${incompatible.kind} cannot be measured in ${unit}; select a supported unit or a manual quantity.` };
  const quantity=Math.round(matches.reduce((sum, line) => sum + line.quantity, 0) * 1e6) / 1e6;
  if(selected&&[...selected].some(id=>!project.elements.some(element=>element.id===id)))return{quantity,issues,error:`${activity.name}: source IDs are stale. Review the model-to-activity mapping before scheduling; missing work is not zero work.`};
  return { quantity, issues };
}

/** Assembly productivity is expressed in that assembly's native quantity unit per working day. */
function resolveTypeProductivity(project:Project, activity:ActivityDefinition):{ productivity:number; issues:string[]; error?:string } {
  const basis = resolveModelQuantity(project, activity);
  if (basis.error) return { productivity:0, issues:basis.issues, error:basis.error };
  const sourceIds = activity.sourceElementIds ? new Set(activity.sourceElementIds) : null;
  const measured = quantities(project).filter(line => line.kind === activity.category && (!sourceIds || sourceIds.has(line.elementId)));
  let workDays = 0;
  for (const line of measured) {
    const type = project.types.find(candidate => candidate.id === line.typeId);
    if (!type || !Number.isFinite(type.productivity) || type.productivity <= 0) return { productivity:0, issues:basis.issues, error:`${activity.name}: missing or invalid assembly productivity for ${type?.name ?? line.name}. Confirm a positive ${type?.unit ?? line.unit}/working day value or enter manual activity productivity.` };
    if (type.kind !== line.kind) return { productivity:0, issues:basis.issues, error:`${activity.name}: assembly ${type.name} does not match source element kind ${line.kind}.` };
    workDays += line.quantity / type.productivity;
  }
  if (!measured.length || basis.quantity === 0) return { productivity:Number.isFinite(activity.productivity) && activity.productivity > 0 ? activity.productivity : 1, issues:[...basis.issues, `${activity.name}: no positive measured work; minimum setup duration still applies.`] };
  return { productivity:basis.quantity / workDays, issues:[...basis.issues, `${activity.name}: duration basis = sum of each source quantity ÷ its assembly productivity; ${Math.round(workDays * 1000) / 1000} working days before minimum duration/calendar/resource limits.`] };
}

/** Resource-constrained serial-day scheduler. Productivity is per activity, not multiplied by crews. */
export function buildSchedule(project:Project, overrides:{crews?:number;procurementDays?:number} = {}):ScheduleResult {
  const config = project.schedule;
  const issues:string[] = [];
  const input = config.activities.length ? config.activities.map(activity => ({ ...activity, predecessors:[...activity.predecessors] })) : generateActivities(project);
  const crews = overrides.crews ?? config.crews;
  const procurement = overrides.procurementDays ?? config.procurementDays;
  const failure = (reason:string):ScheduleResult => ({ activities:[], startDate:config.startDate, finishDate:config.startDate, durationDays:0, workingDays:0, feasible:false, issues:[...issues, reason], criticalPath:[], crewDays:0 });
  if(config.modelReviewRequired)return failure('The model changed after the construction plan was reviewed. Review model quantities and activity scope before using completion dates or ranking scenarios.');
  if(config.modelReview&&(config.modelReview.modelSignature!==scheduleModelSignature(project)||config.modelReview.activitySignature!==scheduleActivitySignature(input)))return failure('The reviewed model scope or activity network changed. Review model quantities and activity scope again before using completion dates or ranking scenarios.');
  if(project.services){
    if(!servicePlanIsCurrent(project,project.services))return failure('The service plan is stale. Review and reroute services before using construction completion dates.');
    const programme=calculateServiceProgramme(project,project.services);
    if(programme.workDays===null)return failure('Service installation productivity or scope is unresolved. Enter and review installation work before using completion dates.');
    const mapped=input.filter(activity=>activity.servicePackage),expected=serviceInstallationActivities(project,[],[]);
    if(mapped.length){
      for(const template of expected){
        const matches=mapped.filter(activity=>activity.servicePackage===template.servicePackage);
        if(matches.length!==1)return failure('Service work packages must map routes and points once each. Review missing or duplicate service installation tasks.');
        const activity=matches[0],near=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-12,Math.abs(b)*1e-10);
        if(activity.category!=='allowance'||activity.quantityMode!=='manual'||activity.productivityMode!=='manual'||activity.unit!==template.unit||!near(activity.quantity,template.quantity)||!near(activity.productivity,template.productivity)||activity.fixedDuration!==undefined||activity.sourceElementIds?.length)return failure(`${activity.name}: mapped service effort no longer matches current route quantities, point counts and entered productivity. Review and accept service work scope before using completion dates; detach the service mapping explicitly to enter a separate manual work package.`);
      }
      if(mapped.length!==expected.length)return failure('A mapped service work package has no represented scope. Review task removal and dependencies explicitly.');
    }
    if(config.activities.length&&!mapped.length)issues.push('Existing manual services activities remain unchanged. Concept service installation effort is shown separately; reconcile its scope with the existing work packages before claiming the full construction completion date.');
    issues.push(...programme.issues);
  }
  else if(input.some(activity=>activity.servicePackage))return failure('Mapped service installation tasks have no service plan. Review service scope before using completion dates.');
  if(!config.activities.length&&!project.elements.some(element=>!['room','reference'].includes(element.kind)))return failure('There is no modelled construction work or entered activity network. Define work scope before estimating completion; an empty model is not a zero-day building.');
  if (!isDate(config.startDate)) return failure('Project start date must be a valid ISO date.');
  const calendar = Array.from(new Set(config.workingDays));
  if (!calendar.length || calendar.some(day => !Number.isInteger(day) || day < 0 || day > 6)) return failure('Working calendar must include valid weekdays (0 Sunday to 6 Saturday).');
  if((config.holidays??[]).some(date=>!isDate(date)))return failure('Holiday exceptions must use valid ISO dates.');
  const holidays=new Set(config.holidays??[]);
  if(holidays.size)issues.push(`${holidays.size} explicit non-working holiday date(s) excluded from the working calendar.`);
  if (!Number.isInteger(crews) || crews < 1 || crews > 1000) return failure('Available crew count must be an integer between 1 and 1000.');
  if (!Number.isFinite(procurement) || procurement < 0) return failure('Procurement offset must be a non-negative number of calendar days.');
  if (crews > project.constraints.maxCrews) return failure(`Crew count ${crews} exceeds project limit ${project.constraints.maxCrews}.`);
  if (!input.length) return failure('Schedule has no activities.');
  for (const activity of input) {
    const missing=(activity.sourceElementIds??[]).filter(id=>!project.elements.some(element=>element.id===id));
    if(missing.length)return failure(`${activity.name}: source IDs ${missing.join(', ')} are stale. Review the model-to-activity mapping; missing work is not zero work.`);
    if (activity.quantityMode === 'model') {
      const resolved = resolveModelQuantity(project, activity);
      issues.push(...resolved.issues);
      if (resolved.error) return failure(resolved.error);
      activity.quantity = resolved.quantity;
    }
    if (activity.productivityMode === 'type' && activity.fixedDuration === undefined) {
      const resolved = resolveTypeProductivity(project, activity);
      issues.push(...resolved.issues);
      if (resolved.error) return failure(resolved.error);
      activity.productivity = resolved.productivity;
    }
  }
  if (!config.activities.length) issues.push('Generated preliminary template: site, foundations, structure, services and finish quantities/durations are assumptions. Confirm unmodelled scope, curing, inspections and productivity with the planner.');
  else if (input.some(activity => activity.quantityMode === 'manual')) issues.push('Manual activity quantities are planner-owned snapshots; review unmodelled/proxy scope after design revisions. Model-linked quantities recalculate from live elements.');
  issues.push('Task productivity is fixed per activity. Additional available crews permit concurrent activities; no automatic linear speed-up is assumed.');
  if (procurement > 0) issues.push(`Procurement release uses ${procurement} calendar days plus each procurement-dependent activity’s lead time. Confirm supplier availability.`);
  const byId = new Map(input.map(activity => [activity.id, activity]));
  if (byId.size !== input.length) return failure('Activity IDs must be unique.');
  const duration = new Map<string, number>();
  for (const activity of input) {
    if (!activity.id) return failure('Every activity needs an ID.');
    if (activity.predecessors.some(id => !byId.has(id))) return failure(`${activity.name}: predecessor references an unknown activity.`);
    if (!Number.isFinite(activity.quantity) || activity.quantity < 0 || !Number.isFinite(activity.minDuration) || activity.minDuration < 0 || !Number.isFinite(activity.leadTime) || activity.leadTime < 0) return failure(`${activity.name}: quantity, minimum duration and lead time must be finite and non-negative.`);
    if (!Number.isInteger(activity.crewDemand) || activity.crewDemand < 1 || !Number.isInteger(activity.maxCrews) || activity.maxCrews < activity.crewDemand) return failure(`${activity.name}: crew demand must be positive and no larger than its task crew limit.`);
    if (activity.crewDemand > crews) return failure(`${activity.name} needs ${activity.crewDemand} crews but only ${crews} are available.`);
    if (activity.fixedDuration !== undefined && (!Number.isFinite(activity.fixedDuration) || activity.fixedDuration < 1)) return failure(`${activity.name}: fixed duration must be at least one working day.`);
    if (activity.fixedDuration === undefined && (!Number.isFinite(activity.productivity) || activity.productivity <= 0)) return failure(`${activity.name}: positive productivity is required; an unknown duration is not zero.`);
    const days = activity.fixedDuration !== undefined ? Math.ceil(activity.fixedDuration) : Math.max(1, Math.ceil(activity.minDuration), Math.ceil(activity.quantity / activity.productivity - 1e-9));
    if (days > 20_000) return failure(`${activity.name}: duration exceeds the supported planning horizon.`);
    duration.set(activity.id, days);
  }
  const pending = new Set(input.map(activity => activity.id));
  const order:ActivityDefinition[] = [];
  while (pending.size) {
    const available = input.filter(activity => pending.has(activity.id) && activity.predecessors.every(id => !pending.has(id)));
    if (!available.length) return failure('Dependency cycle detected. Remove the circular predecessor links before scheduling.');
    for (const activity of available) { pending.delete(activity.id); order.push(activity); }
  }
  const successors = new Map(input.map(activity => [activity.id, [] as string[]]));
  for (const activity of input) for (const predecessor of activity.predecessors) successors.get(predecessor)!.push(activity.id);
  const downstream = new Map<string,number>();
  for (const activity of [...order].reverse()) downstream.set(activity.id, duration.get(activity.id)! + Math.max(0, ...successors.get(activity.id)!.map(id => downstream.get(id)!)));
  const prioritised = [...order].sort((a, b) => downstream.get(b.id)! - downstream.get(a.id)! || order.indexOf(a) - order.indexOf(b));

  const origin = new Date(`${config.startDate}T00:00:00Z`);
  const workDates:Date[] = [];
  const dateAt = (index:number):Date => {
    let cursor = workDates.length ? new Date(workDates[workDates.length - 1].getTime() + DAY) : new Date(origin);
    while (workDates.length <= index) { if (calendar.includes(cursor.getUTCDay())&&!holidays.has(iso(cursor))) workDates.push(new Date(cursor)); cursor = new Date(cursor.getTime() + DAY); }
    return workDates[index];
  };
  const release = new Map(input.map(activity => [activity.id, activity.leadTime > 0 ? origin.getTime() + Math.ceil(activity.leadTime + procurement) * DAY : origin.getTime()]));
  const scheduled = new Map<string, ScheduledActivity>();
  const workStart = new Map<string,number>(), workFinish = new Map<string,number>();
  const resourcePred = new Map<string,string[]>();
  const crewSlots = Array.from({ length:crews }, () => ({ until:-1, previous:'' }));
  let day = 0;
  while (scheduled.size < input.length && day < 20_000) {
    const today = dateAt(day);
    for (const activity of prioritised) {
      if (scheduled.has(activity.id) || activity.predecessors.some(id => !scheduled.has(id) || workFinish.get(id)! >= day) || release.get(activity.id)! > today.getTime()) continue;
      const free = crewSlots.map((slot, index) => ({ ...slot, index })).filter(slot => slot.until < day);
      if (free.length < activity.crewDemand) continue;
      const reserved = free.slice(0, activity.crewDemand);
      const days = duration.get(activity.id)!;
      const finish = day + days - 1;
      workStart.set(activity.id, day); workFinish.set(activity.id, finish);
      resourcePred.set(activity.id, reserved.map(slot => slot.previous).filter(Boolean));
      for (const slot of reserved) crewSlots[slot.index] = { until:finish, previous:activity.id };
      scheduled.set(activity.id, { ...activity, startDate:iso(today), finishDate:iso(dateAt(finish)), startDay:Math.round((today.getTime() - dateAt(0).getTime()) / DAY), finishDay:Math.round((dateAt(finish).getTime() - dateAt(0).getTime()) / DAY), duration:days, assignedCrews:activity.crewDemand, critical:false });
    }
    day++;
  }
  if (scheduled.size < input.length) return failure('No feasible schedule within 20,000 working days. Review dependencies, resources and procurement release dates.');
  const finalWorkDay = Math.max(...workFinish.values());
  // Include resource hand-offs in the backward pass so the displayed driver reflects finite crews.
  const actualSuccessors = new Map(input.map(activity => [activity.id, new Set<string>()]));
  for (const activity of input) for (const predecessor of [...activity.predecessors, ...(resourcePred.get(activity.id) ?? [])]) actualSuccessors.get(predecessor)!.add(activity.id);
  const latestStart = new Map<string,number>();
  const reverseActual = [...scheduled.values()].sort((a, b) => workStart.get(b.id)! - workStart.get(a.id)!);
  for (const activity of reverseActual) {
    const children = [...actualSuccessors.get(activity.id)!];
    const latestFinish = children.length ? Math.min(...children.map(id => latestStart.get(id)! - 1)) : finalWorkDay;
    latestStart.set(activity.id, latestFinish - activity.duration + 1);
    activity.critical = latestStart.get(activity.id)! === workStart.get(activity.id)!;
  }
  const activities = [...scheduled.values()].sort((a, b) => a.startDay - b.startDay || a.id.localeCompare(b.id));
  const startDate = iso(dateAt(0)), finishDate = iso(dateAt(finalWorkDay));
  return { activities, startDate, finishDate, durationDays:Math.round((dateAt(finalWorkDay).getTime() - dateAt(0).getTime()) / DAY) + 1, workingDays:finalWorkDay + 1, feasible:true, issues, criticalPath:activities.filter(activity => activity.critical).map(activity => activity.id), crewDays:activities.reduce((sum, activity) => sum + activity.duration * activity.assignedCrews, 0) };
}
