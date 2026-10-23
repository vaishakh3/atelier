import type { ElementType, Objective, Project, Scenario } from '../domain/types';
import { estimate } from './cost';
import { buildSchedule } from './schedule';

const knownRate = (type:ElementType) => [type.materialRate, type.labourRate, type.equipmentRate].every(rate => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0);
const unitCost = (type:ElementType) => (type.materialRate ?? Infinity) * (1 + type.wastePercent / 100) + (type.labourRate ?? Infinity) + (type.equipmentRate ?? Infinity);
const locked = (project:Project, property:string, elementId?:string) => project.constraints.lockedProperties.some(key => key === '*' || key === property || key === `schedule.${property}` || key === `constraints.${property}` || (!!elementId && (key === `${elementId}.${property}` || key === `${elementId}.*`)));

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
  const evaluate = (replacement:typeof replacements[number], crews:number, procurementDays:number, baseline = false) => {
    const signature = JSON.stringify([replacement.changes, crews, procurementDays]);
    if (signatures.has(signature)) return;
    signatures.add(signature);
    const candidate:Project = { ...project, elements:project.elements.map(element => {
      const target = project.types.find(type => type.id === replacement.changes[element.id]);
      return target ? { ...element, typeId:target.id, material:target.material } : element;
    }), schedule:{ ...project.schedule, crews, procurementDays } };
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
    scenarios.push({ id:baseline ? 'baseline' : `scenario-${scenarios.length}`, name:baseline ? 'Baseline' : [Object.keys(replacement.changes).length ? replacement.name : '', crews !== baseCrews ? `${crews} crews` : '', procurementDays !== project.schedule.procurementDays ? 'Earlier procurement' : ''].filter(Boolean).join(' · ') || 'Same approved design', baselineVersion:project.version, changes, crews, procurementDays, typeChanges:replacement.changes, cost, schedule, feasible:reasons.length === 0, reasons, dominated:false });
  };
  evaluate(replacements[0], baseCrews, project.schedule.procurementDays, true);
  for (const replacement of replacements) for (const crews of crewOptions) for (const procurementDays of procurementOptions) evaluate(replacement, crews, procurementDays);
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
