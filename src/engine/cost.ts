import type { CostLine, CostResult, Project, ScheduleResult } from '../domain/types';
import { quantities } from './quantities';
import { buildSchedule } from './schedule';

const money = (value:number) => Math.round(value * 100) / 100;
const usableRate = (value:number|null|undefined):value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** All totals are known subtotals. A missing rate stays null and reduces completeness. */
export function estimate(project:Project, scheduleResult?:ScheduleResult):CostResult {
  const lines:CostLine[] = [];
  const issues:string[] = [];
  let material = 0, labour = 0, equipment = 0, waste = 0, allowances = 0;
  let complete = 0, count = 0;
  const measured = quantities(project).filter(line => !['room', 'reference'].includes(line.kind));
  const grouped = new Map<string, typeof measured>();
  for (const line of measured) {
    const key = `${line.typeId}:${line.unit}`;
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  }
  for (const group of grouped.values()) {
    const first = group[0];
    const type = project.types.find(candidate => candidate.id === first.typeId);
    const quantity = group.reduce((sum, line) => sum + line.quantity, 0);
    const lineIssues = Array.from(new Set(group.flatMap(line => line.issues)));
    const currencyMatches=!type?.rateCurrency||type.rateCurrency===project.currency;
    if(!currencyMatches)lineIssues.push(`Rate currency ${type?.rateCurrency} does not match project currency ${project.currency}; conversion must be entered explicitly.`);
    if(!type?.rateSource)lineIssues.push('Rate source not supplied; confirm quotation or library provenance.');
    const component = (rate:number|null|undefined, label:string) => {
      if(!currencyMatches)return null;
      if (!usableRate(rate)) { lineIssues.push(`Missing or invalid ${label} rate; this component is unknown, not free.`); return null; }
      const value=quantity*rate;
      if(!Number.isFinite(value)||!Number.isSafeInteger(Math.round(value*100))){lineIssues.push(`Invalid ${label} calculation exceeds supported monetary precision; this component is unresolved.`);return null;}
      return money(value);
    };
    const lineMaterial = component(type?.materialRate, 'material');
    const lineLabour = component(type?.labourRate, 'labour');
    const lineEquipment = component(type?.equipmentRate, 'equipment');
    const wasteKnown = type && Number.isFinite(type.wastePercent) && type.wastePercent >= 0;
    if (!wasteKnown) lineIssues.push('Waste factor is unknown or invalid.');
    const lineWaste = lineMaterial !== null && wasteKnown ? money(lineMaterial * type.wastePercent / 100) : 0;
    const invalidGeometry = lineIssues.some(issue => /must be positive|negative or non-finite|exceed gross|does not match|overlap|outside host|not aligned|same level|invalid opening|no valid|Invalid measurement/.test(issue));
    const total = lineMaterial !== null && lineLabour !== null && lineEquipment !== null && wasteKnown && !invalidGeometry ? money(lineMaterial + lineLabour + lineEquipment + lineWaste) : null;
    material += lineMaterial ?? 0; labour += lineLabour ?? 0; equipment += lineEquipment ?? 0; waste += lineWaste;
    count++; if (total !== null) complete++;
    lines.push({ id:`type:${first.typeId}:${first.unit}`, name:type?.name ?? `Unmapped: ${first.typeId || first.name}`, sourceIds:group.map(line => line.elementId), quantity, unit:first.unit, material:lineMaterial, labour:lineLabour, equipment:lineEquipment, waste:lineWaste, total, formula:`${quantity} ${first.unit} × (material ${type?.materialRate ?? '?'} + labour ${type?.labourRate ?? '?'} + equipment ${type?.equipmentRate ?? '?'}) + material waste ${type?.wastePercent ?? '?'}%`, rateDate:type?.rateDate ?? '', rateCurrency:type?.rateCurrency??project.currency,rateSource:type?.rateSource??'',issues:lineIssues });
  }
  for (const allowance of project.allowances) {
    if (!allowance.included) { issues.push(`Excluded scope: ${allowance.name}.`); continue; }
    const known = usableRate(allowance.amount);
    count++; if (known) complete++;
    const amount = known ? allowance.amount : null;
    allowances += amount ?? 0;
    lines.push({ id:`allowance:${allowance.id}`, name:allowance.name, sourceIds:[], quantity:1, unit:'allowance', material:null, labour:null, equipment:null, waste:0, total:amount, formula:`Independent allowance = ${amount ?? 'unknown'}`, rateDate:'', issues:known ? [] : ['Allowance amount is unknown, not zero.'] });
  }
  const schedule = scheduleResult ?? buildSchedule(project);
  const overheadRateKnown = usableRate(project.schedule.overheadPerDay);
  const crewRateKnown = usableRate(project.schedule.crewCostPerDay);
  // Daily overhead accrues over elapsed calendar days, including non-working days.
  const overhead = overheadRateKnown && schedule.feasible ? money(project.schedule.overheadPerDay * schedule.durationDays) : 0;
  if (!overheadRateKnown) issues.push('Daily overhead rate is invalid.');
  if (!schedule.feasible) issues.push('Schedule is infeasible; time-related overhead and incremental crew costs remain unpriced.');
  if (overheadRateKnown && schedule.feasible) lines.push({ id:'time:overhead', name:'Site overhead (calendar days)', sourceIds:[], quantity:schedule.durationDays, unit:'calendar days', material:0, labour:0, equipment:0, waste:0, total:overhead, formula:`${schedule.durationDays} elapsed calendar days × ${project.schedule.overheadPerDay}/day`, rateDate:'', issues:[] });
  let crewCost = 0;
  if (crewRateKnown && schedule.feasible && project.schedule.crewCostPerDay > 0) {
    crewCost = money(schedule.crewDays * project.schedule.crewCostPerDay);
    labour += crewCost;
    const warning = 'Crew rate is an explicit incremental charge in addition to unit labour. Set it to zero if wages are already included in unit labour rates.';
    issues.push(warning);
    lines.push({ id:'time:crews', name:'Incremental crew charge', sourceIds:[], quantity:schedule.crewDays, unit:'crew-days', material:0, labour:crewCost, equipment:0, waste:0, total:crewCost, formula:`${schedule.crewDays} assigned crew-days × ${project.schedule.crewCostPerDay}/day (incremental only)`, rateDate:'', issues:[warning] });
  }
  if (!crewRateKnown) issues.push('Incremental crew cost rate is invalid.');
  for (const line of lines) for (const issue of line.issues) issues.push(`${line.name}: ${issue}`);
  const references = project.elements.filter(element => element.kind === 'reference');
  if (references.length) issues.push(`${references.length} reference-only element(s) excluded from measured cost scope.`);
  if (!project.allowances.length) issues.push('No independent scope allowances entered. Review foundations, services, site work, permits, taxes and other unmodelled costs.');
  if(project.types.some(type=>!type.rateCurrency&&measured.some(line=>line.typeId===type.id)))issues.push(`Legacy rates without an explicit rate currency are assumed to use project currency ${project.currency}; confirm before changing currency.`);
  issues.push('Preliminary estimate. Completeness covers mapped model items and included allowances; unentered scope is not represented. Rates are user-supplied.');
  if (complete < count) issues.push('Total is a known subtotal: unknown components and allowances are excluded until resolved.');
  const completeness = count ? Math.round(100 * complete / count) : 0;
  return { lines, material:money(material), labour:money(labour), equipment:money(equipment), waste:money(waste), allowances:money(allowances), overhead, total:money(material + labour + equipment + waste + allowances + overhead), completeness:(!overheadRateKnown || !crewRateKnown || !schedule.feasible) ? Math.min(completeness, 99) : completeness, issues:Array.from(new Set(issues)) };
}
