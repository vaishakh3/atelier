import type { ActivityDefinition, ElementType, Objective, Project, Scenario, SequenceAlternative } from '../domain/types';
import { estimate } from './cost';
import { buildSchedule,generateActivities } from './schedule';

const knownRate = (type:ElementType) => [type.materialRate, type.labourRate, type.equipmentRate].every(rate => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0);
const unitCost = (type:ElementType) => (type.materialRate ?? Infinity) * (1 + type.wastePercent / 100) + (type.labourRate ?? Infinity) + (type.equipmentRate ?? Infinity);
const locked = (project:Project, property:string, elementId?:string) => project.constraints.lockedProperties.some(key => key === '*' || key === property || key === `schedule.${property}` || key === `constraints.${property}` || (['crews','procurementDays','predecessors'].includes(property)&&['schedule','schedule.*'].includes(key)) || (!!elementId && (key === `${elementId}.${property}` || key === `${elementId}.*`)));
const activitiesOf=(project:Project)=>project.schedule.activities.length?structuredClone(project.schedule.activities):generateActivities(project);
const sorted=(values:string[])=>[...values].sort();

/** Canonical network text, not a publisher/digital signature. No collision-prone hash is used. */
export function sequenceBaselineSignature(project:Project):string {
  return'atelier-sequence-v1:'+JSON.stringify(activitiesOf(project).map(activity=>({id:activity.id,category:activity.category,predecessors:sorted(activity.predecessors),sourceElementIds:activity.sourceElementIds?sorted([...new Set(activity.sourceElementIds)]):null})).sort((a,b)=>a.id.localeCompare(b.id)));
}
export interface SequencePreview {activities:ActivityDefinition[];changes:NonNullable<Scenario['sequenceChanges']>;issues:string[]}
/** Only named, approved, baseline-bound predecessor patches are considered. */
export function previewSequenceAlternative(project:Project,alternative:SequenceAlternative):SequencePreview {
  const activities=activitiesOf(project),byId=new Map(activities.map(activity=>[activity.id,activity])),changes:SequencePreview['changes']=[],issues:string[]=[];
  if(!alternative.approved)issues.push('This sequencing alternative requires explicit planner approval.');
  if(!alternative.name.trim()||!alternative.rationale.trim())issues.push('Provide a name and planner rationale before approving a sequencing alternative.');
  if(alternative.baselineSignature!==sequenceBaselineSignature(project))issues.push('The baseline activity network/source selection changed after approval. Review and approve this alternative again.');
  if((project.schedule.sequenceAlternatives??[]).filter(candidate=>candidate.id===alternative.id).length>1)issues.push('Sequencing alternative IDs must be unique.');
  if(!Object.keys(alternative.predecessors).length)issues.push('This sequencing alternative has no explicit dependency changes.');
  for(const [id,predecessors]of Object.entries(alternative.predecessors)){
    const activity=byId.get(id);
    if(!activity){issues.push(`Unknown activity ${id} in sequencing alternative.`);continue;}
    if(new Set(predecessors).size!==predecessors.length||predecessors.includes(id)){issues.push(`${activity.name}: duplicate or self-referencing predecessors are not allowed.`);continue;}
    const unknown=predecessors.filter(predecessor=>!byId.has(predecessor));if(unknown.length){issues.push(`${activity.name}: unknown predecessors ${unknown.join(', ')}.`);continue;}
    if(JSON.stringify(sorted(activity.predecessors))===JSON.stringify(sorted(predecessors)))continue;
    const specificallyLocked=project.constraints.lockedProperties.some(key=>['activities','schedule.activities','schedule.activities.*',`${id}.predecessors`,`activities.${id}.predecessors`,`schedule.activities.${id}.predecessors`].includes(key));
    if(locked(project,'predecessors',id)||specificallyLocked){issues.push(`${activity.name}: dependency changes are locked.`);continue;}
    changes.push({activityId:id,before:[...activity.predecessors],after:[...predecessors]});activity.predecessors=[...predecessors];
  }
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(id:string):boolean=>{if(visiting.has(id))return false;if(visited.has(id))return true;visiting.add(id);for(const predecessor of byId.get(id)?.predecessors??[])if(!byId.has(predecessor)||!visit(predecessor))return false;visiting.delete(id);visited.add(id);return true;};
  if(activities.some(activity=>!visit(activity.id)))issues.push('The approved dependency variant has a cycle or missing baseline predecessor.');
  if(!changes.length&&!issues.length)issues.push('This sequencing alternative does not change the baseline dependency network.');
  return{activities:issues.length?[]:activities,changes:issues.length?[]:changes,issues:[...new Set(issues)]};
}

/** Bounded deterministic enumeration, not a claim of global construction optimality. */
export function compareScenarios(project:Project, objective:Objective):Scenario[] {
  const baseCrews = project.schedule.crews;
  const maxCrews = Math.max(1, Math.min(12, Math.floor(project.constraints.maxCrews)));
  const crewOptions = locked(project, 'crews') ? [baseCrews] : [...new Set([baseCrews, Math.max(1, baseCrews - 1), Math.min(maxCrews, baseCrews + 1), maxCrews])].filter(count => count >= 1 && count <= maxCrews);
  const procurementOptions = locked(project, 'procurementDays') ? [project.schedule.procurementDays] : [...new Set([project.schedule.procurementDays, Math.max(0, project.schedule.procurementDays - 5)])];
  const replacements:{name:string; changes:Record<string,string>}[] = [{ name:'Approved design', changes:{} }];
  for (const original of project.types) {
    const editable = project.elements.filter(element => element.typeId === original.id && element.editable && !project.constraints.lockedElementIds.includes(element.id) && !locked(project, 'typeId', element.id) && !locked(project, 'material', element.id) && !locked(project, 'specification', element.id));
    if (!editable.length || ['room', 'reference'].includes(original.kind)) continue;
    const alternatives = project.types.filter(type => type.id !== original.id && type.kind === original.kind && type.approved && knownRate(type)).sort((a, b) => unitCost(a) - unitCost(b) || a.id.localeCompare(b.id)).slice(0, 2);
    for (const alternative of alternatives) {
      replacements.push({ name:`${original.name} → ${alternative.name}`, changes:Object.fromEntries(editable.map(element => [element.id, alternative.id])) });
      if (replacements.length >= 9) break;
    }
    if (replacements.length >= 9) break;
  }
  const scenarios:Scenario[] = [];
  const signatures = new Set<string>();
  const excludedSequences:string[]=[];
  const sequences:{alternative?:SequenceAlternative;preview?:SequencePreview}[]=[{}];
  for(const alternative of (project.schedule.sequenceAlternatives??[]).slice(0,6)){
    if(!alternative.approved){excludedSequences.push(`${alternative.name}: not approved; not searched.`);continue;}
    const preview=previewSequenceAlternative(project,alternative);
    if(preview.issues.length){excludedSequences.push(`${alternative.name}: ${preview.issues.join(' ')}`);continue;}
    sequences.push({alternative,preview});
  }
  const limit=128;
  const evaluate = (replacement:typeof replacements[number], crews:number, procurementDays:number, sequence:typeof sequences[number], baseline = false) => {
    const signature = JSON.stringify([replacement.changes, crews, procurementDays,sequence.alternative?.id??null]);
    if (signatures.has(signature)) return;
    signatures.add(signature);
    const candidate:Project = { ...project, elements:project.elements.map(element => {
      const target = project.types.find(type => type.id === replacement.changes[element.id]);
      return target ? { ...element, typeId:target.id, material:target.material } : element;
    }), schedule:{ ...project.schedule, crews, procurementDays,...(sequence.preview?{activities:sequence.preview.activities}:{}) } };
    const schedule = buildSchedule(candidate);
    const cost = estimate(candidate, schedule);
    const reasons:string[] = [];
    if (!schedule.feasible) reasons.push(...schedule.issues);
    if (cost.completeness < 100) reasons.push(`Estimate is ${cost.completeness}% complete; resolve unknown rates, invalid measurements and allowances before ranking savings.`);
    if (project.constraints.budget !== null && (!Number.isFinite(project.constraints.budget) || cost.total > project.constraints.budget)) reasons.push(`Known estimated cost ${cost.total.toFixed(2)} exceeds budget ${project.constraints.budget}.`);
    if (project.constraints.deadline && schedule.finishDate > project.constraints.deadline) reasons.push(`Completion ${schedule.finishDate} is later than deadline ${project.constraints.deadline}.`);
    if (objective === 'cost' && !project.constraints.deadline) reasons.push('Set a deadline for the lowest-cost-before-deadline objective.');
    if (objective === 'time' && project.constraints.budget === null) reasons.push('Set a budget for the earliest-completion-within-budget objective.');
    const changes:string[] = [];
    if (Object.keys(replacement.changes).length) changes.push(`${replacement.name}; ${Object.keys(replacement.changes).length} editable elements; geometry unchanged`);
    if (crews !== baseCrews) changes.push(`${crews} available crews (baseline ${baseCrews}); enables task concurrency only`);
    if (procurementDays !== project.schedule.procurementDays) changes.push(`Procurement release offset ${procurementDays} calendar days (baseline ${project.schedule.procurementDays}); requires earlier confirmed ordering`);
    if(sequence.alternative&&sequence.preview){changes.push(`Approved sequence: ${sequence.alternative.name}; ${sequence.alternative.rationale}`);for(const change of sequence.preview.changes)changes.push(`${change.activityId}: predecessors [${change.before.join(', ')||'none'}] → [${change.after.join(', ')||'none'}]`);}
    scenarios.push({ id:baseline ? 'baseline' : `scenario-${scenarios.length}`, name:baseline ? 'Baseline' : [sequence.alternative?.name??'',Object.keys(replacement.changes).length ? replacement.name : '', crews !== baseCrews ? `${crews} crews` : '', procurementDays !== project.schedule.procurementDays ? 'Earlier procurement' : ''].filter(Boolean).join(' · ') || 'Same approved design', baselineVersion:project.version, changes, crews, procurementDays, typeChanges:replacement.changes, cost, schedule, feasible:reasons.length === 0, reasons, dominated:false,...(sequence.alternative?{sequenceAlternativeId:sequence.alternative.id,sequenceRationale:sequence.alternative.rationale,sequenceChanges:sequence.preview!.changes}:{}) });
  };
  evaluate(replacements[0], baseCrews, project.schedule.procurementDays,sequences[0], true);
  // Round-robin explicit sequences within each input combination; no variant can monopolise the cap.
  outer:for (const replacement of replacements) for (const crews of crewOptions) for (const procurementDays of procurementOptions)for(const sequence of sequences){if(scenarios.length>=limit)break outer;evaluate(replacement, crews, procurementDays,sequence);}
  const totalCandidates=replacements.length*crewOptions.length*procurementOptions.length*sequences.length+(crewOptions.includes(baseCrews)?0:1);
  const searchInfo={evaluated:scenarios.length,totalCandidates,limit,truncated:scenarios.length<totalCandidates,approvedSequenceIds:sequences.flatMap(sequence=>sequence.alternative?[sequence.alternative.id]:[])};
  for(const scenario of scenarios){scenario.searchInfo=searchInfo;scenario.schedule.issues.push(...excludedSequences.map(issue=>`Sequencing alternative excluded: ${issue}`));if(searchInfo.truncated)scenario.schedule.issues.push(`Bounded search evaluated ${searchInfo.evaluated} of ${totalCandidates} configured combinations (limit ${limit}); reported alternatives are non-dominated only among evaluated candidates.`);}
  const feasible = scenarios.filter(scenario => scenario.feasible);
  for (const candidate of feasible) {
    candidate.dominated = feasible.some(other => other.id !== candidate.id && other.cost.total <= candidate.cost.total && other.schedule.finishDate <= candidate.schedule.finishDate && (other.cost.total < candidate.cost.total || other.schedule.finishDate < candidate.schedule.finishDate));
  }
  const baseline = scenarios[0];
  const frontier = scenarios.slice(1).filter(scenario => scenario.feasible && !scenario.dominated);
  frontier.sort((a, b) => objective === 'time' ? a.schedule.finishDate.localeCompare(b.schedule.finishDate) || a.cost.total - b.cost.total : a.cost.total - b.cost.total || a.schedule.finishDate.localeCompare(b.schedule.finishDate));
  // Collapse numerically equivalent alternatives while retaining a reproducible input explanation.
  const seenMetrics = new Set<string>(baseline.feasible && !baseline.dominated ? [`${baseline.cost.total}:${baseline.schedule.finishDate}`] : []);
  const unique = frontier.filter(scenario => {
    const key = `${scenario.cost.total}:${scenario.schedule.finishDate}`;
    if (seenMetrics.has(key)) return false;
    seenMetrics.add(key); return true;
  });
  if (!feasible.length) {
    baseline.reasons.push('No candidate in the bounded search satisfies the selected objective and current constraints. Relax a constraint or correct incomplete inputs.');
    return [baseline, ...scenarios.slice(1).filter(scenario => !scenario.feasible).sort((a, b) => a.reasons.length - b.reasons.length || a.cost.total - b.cost.total).slice(0, 3)];
  }
  return [baseline, ...unique.slice(0, 7)];
}
