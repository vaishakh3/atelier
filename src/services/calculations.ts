import type {ActivityDefinition, CostLine, Project} from '../domain/types';
import type {ServiceAssumptions, ServicePlan, ServicePointKind, ServiceVector} from './types';
import {inspectServiceIntegrity,servicePlanIsCurrent} from './model';

const pointKinds:ServicePointKind[]=['light','switch','socket','equipment','panel','water-inlet','drain-outlet','basin','wc','shower','sink'];
const systems=['electrical','cold-water','drainage'] as const;
const title=(text:string)=>text.replace(/-/g,' ').replace(/^./,character=>character.toUpperCase());
const money=(number:number)=>Math.round(number*100)/100;
const usable=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const positive=(value:unknown):value is number=>usable(value)&&value>0;
const supportedMoney=(value:number)=>Number.isFinite(value)&&Number.isSafeInteger(Math.round(value*100));

/** These are visible conceptual inputs, not statutory requirements, quotations or design criteria. */
export function defaultServiceAssumptions(currency:ServiceAssumptions['currency']):ServiceAssumptions {
 return {currency,rateSource:'Not quoted — enter project rates and crew productivity',rateDate:'',rates:[
  ...pointKinds.map(kind=>({key:`point:${kind}`,name:`${title(kind)} point`,unit:'ea' as const,material:null,labour:null,productivity:null})),
  ...systems.map(system=>({key:`route:${system}`,name:`${title(system)} conceptual route`,unit:'m' as const,material:null,labour:null,productivity:null})),
 ],wastePercent:0,voltage:230,powerFactor:.9,demandFactor:.7,drainageGradient:60,workHoursPerDay:8,crews:1};
}

/** Euclidean 3D centreline length in metres. No conductor multiplicity, bends or hydraulic claim. */
export function serviceRouteLength(points:ServiceVector[]):number|null {
 if(points.length<2||points.some(point=>![point.x,point.y,point.z].every(Number.isFinite)))return null;
 let length=0;
 for(let index=1;index<points.length;index++)length+=Math.hypot(points[index].x-points[index-1].x,points[index].y-points[index-1].y,points[index].z-points[index-1].z);
 return Number.isFinite(length)&&length>0?length:null;
}

interface ServiceQuantity {key:string;name:string;quantity:number;unit:'ea'|'m';sourceIds:string[];valid:boolean}
function serviceQuantities(plan:ServicePlan):ServiceQuantity[] {
 const rows:ServiceQuantity[]=[];
 for(const kind of pointKinds) {
  const points=plan.points.filter(point=>point.kind===kind);
  if(points.length)rows.push({key:`point:${kind}`,name:`${title(kind)} points`,quantity:points.length,unit:'ea',sourceIds:points.map(point=>point.id),valid:true});
 }
 for(const system of systems) {
  const routes=plan.routes.filter(route=>route.system===system);
  if(routes.length){const lengths=routes.map(route=>serviceRouteLength(route.points));rows.push({key:`route:${system}`,name:`${title(system)} conceptual routes`,quantity:lengths.reduce<number>((sum,length)=>sum+(length??0),0),unit:'m',sourceIds:routes.map(route=>route.id),valid:lengths.every(length=>length!==null)});}
 }
 return rows;
}

export interface ServiceEstimate {current:boolean;lines:CostLine[];total:number|null;knownSubtotal:number;completeness:number;issues:string[];unknownCount:number;routeLengthMetres:number}
export function calculateServiceEstimate(project:Project,plan:ServicePlan):ServiceEstimate {
 const current=servicePlanIsCurrent(project,plan),issues:string[]=[];
 if(!current)issues.push('Services are stale or contain invalid references/geometry. Review and reroute before using service costs or lengths as a current estimate.',...inspectServiceIntegrity(project,plan).map(issue=>issue.message));
 const assumptions=plan.assumptions,currencyMatches=assumptions.currency===project.currency;
 if(!currencyMatches)issues.push(`Service rate currency ${assumptions.currency} differs from project ${project.currency}; enter explicit rates in the project currency. No conversion is assumed.`);
 if(!assumptions.rateDate||!assumptions.rateSource.trim()||/not quoted/i.test(assumptions.rateSource))issues.push('Service rates need a quotation source and date; entered figures are preliminary assumptions until reviewed.');
 let knownSubtotal=0;
 const lines=serviceQuantities(plan).map(row=>{
  const matching=assumptions.rates.filter(rate=>rate.key===row.key),rate=matching.length===1?matching[0]:undefined,lineIssues:string[]=[];
  const valid=current&&row.valid&&currencyMatches&&rate?.unit===row.unit;
  if(!current)lineIssues.push('Stale service plan: monetary components suppressed until routing review.');
  if(!row.valid)lineIssues.push('Invalid or zero-length route geometry: quantities and monetary components require review.');
  if(!currencyMatches)lineIssues.push('Currency mismatch: service monetary components are unknown.');
  if(!rate||rate.unit!==row.unit)lineIssues.push('A unique matching rate and unit are required.');
  const component=(value:unknown,label:string)=>{
   if(!valid)return null;
   if(!usable(value)){lineIssues.push(`Unknown ${label} rate; not zero.`);return null;}
   const result=row.quantity*value;if(!supportedMoney(result)){lineIssues.push(`${label} amount exceeds supported precision.`);return null;}return money(result);
  };
  const material=component(rate?.material,'material'),labour=component(rate?.labour,'labour');
  const wasteKnown=usable(assumptions.wastePercent),wasteValue=material!==null&&wasteKnown?material*assumptions.wastePercent/100:0;
  const waste= supportedMoney(wasteValue)?money(wasteValue):0;
  if(!wasteKnown||!supportedMoney(wasteValue))lineIssues.push('Unknown or unsupported waste allowance.');
  const sum=(material??0)+(labour??0)+waste;
  if(supportedMoney(sum))knownSubtotal+=sum;else lineIssues.push('Line amount exceeds supported precision.');
  const total=material!==null&&labour!==null&&wasteKnown&&supportedMoney(wasteValue)&&supportedMoney(sum)?money(sum):null;
  return{id:`services:${row.key}`,name:row.name,sourceIds:row.sourceIds,quantity:row.quantity,unit:row.unit,material,labour,equipment:0,waste,total,formula:`${row.quantity} ${row.unit} × (material ${rate?.material??'?'} + labour ${rate?.labour??'?'}) + material waste ${assumptions.wastePercent}%. Routes: sum √(Δx²+Δy²+Δz²); conceptual centreline only, not actual cable quantity.`,rateDate:assumptions.rateDate,rateCurrency:assumptions.currency,rateSource:assumptions.rateSource,issues:lineIssues} satisfies CostLine;
 });
 // A safe component can still overflow after adding many lines. Never emit an unsafe
 // combined sum or silently replace a large complete installation with zero.
 if(!supportedMoney(knownSubtotal)){
  issues.push('Combined service amounts exceed supported monetary precision. All service monetary components are unresolved until quantities/rates are corrected.');
  knownSubtotal=0;
  for(const line of lines){line.material=null;line.labour=null;line.waste=0;line.total=null;line.issues.push('Combined service estimate exceeds supported precision; excluded from known subtotal.');}
 }
 const unknownCount=lines.filter(line=>line.total===null).length;
 if(unknownCount)issues.push('Service total is a known subtotal; unpriced components are excluded and are not savings.');
 issues.push('Concept coordination quantities only. Cable counts, fittings, supports, equipment selection, testing, taxes and specialist design are excluded unless explicitly priced within entered rates. Shared route segments are measured per drawn route; consolidate routes before procurement.');
 if(project.allowances.some(allowance=>allowance.included&&/service|mep|electri|plumb|water|drain/i.test(allowance.name)))issues.push('An included services allowance may overlap these service line items. Reconcile or exclude the allowance before treating the combined estimate as complete.');
 if(lines.length===0)issues.push('No service points or routes are represented; this is not a zero-cost installation.');
 const total=current&&lines.length>0&&unknownCount===0&&supportedMoney(knownSubtotal)?money(knownSubtotal):null;
 return{current,lines,total,knownSubtotal:supportedMoney(knownSubtotal)?money(knownSubtotal):0,completeness:lines.length?Math.round(100*(lines.length-unknownCount)/lines.length):0,unknownCount,routeLengthMetres:current?lines.filter(line=>line.unit==='m').reduce((sum,line)=>sum+line.quantity,0):0,issues};
}

export interface ServiceProgrammeLine {key:string;name:string;quantity:number;unit:string;productivity:number|null;crewDays:number|null;workDays:number|null;formula:string}
export interface ServiceProgramme {current:boolean;lines:ServiceProgrammeLine[];crewDays:number|null;workDays:number|null;issues:string[]}
/** Sequential installation effort only; not calendar completion or a replacement for specialist sequencing. */
export function calculateServiceProgramme(project:Project,plan:ServicePlan):ServiceProgramme {
 const current=servicePlanIsCurrent(project,plan),issues:string[]=[];
 const crewValid=Number.isInteger(plan.assumptions.crews)&&plan.assumptions.crews>0;
 const lines=serviceQuantities(plan).map(row=>{
  const matches=plan.assumptions.rates.filter(rate=>rate.key===row.key),rate=matches.length===1?matches[0]:undefined;
  const productivity=rate?.unit===row.unit&&positive(rate.productivity)?rate.productivity:null;
  const effort=current&&row.valid&&productivity!==null?row.quantity/productivity:null;
  const crewDays=effort!==null&&Number.isFinite(effort)&&effort>0&&effort<=Number.MAX_SAFE_INTEGER?effort:null;
  return{key:row.key,name:row.name,quantity:row.quantity,unit:row.unit,productivity,crewDays,workDays:crewDays!==null&&crewValid?Math.ceil(crewDays-1e-9):null,formula:`${row.quantity} ${row.unit} ÷ ${productivity??'?'} ${row.unit}/crew-day. One installation crew per work package; extra available crews do not imply linear speed-up.`};
 });
 if(!current)issues.push('Stale or invalid service plan: installation effort and duration are unknown until reviewed and rerouted.',...inspectServiceIntegrity(project,plan).map(issue=>issue.message));
 if(!crewValid)issues.push('Enter a positive whole available crew count.');
 if(lines.some(line=>line.crewDays===null))issues.push('Enter positive project-specific productivity for every represented work package. Unknown installation work is not zero days.');
 issues.push('Installation effort uses entered output per crew-day. Sequential phase duration = ceiling of total route crew-days + ceiling of total point crew-days, matching mapped rough-in and fit-off tasks. Individual row rounding is informational and is not added to the phase total. Work hours per day are a descriptive assumption only; productivity is already per crew-day. Procurement, inspections, testing, approvals, curing and specialist work remain separate scope.');
 const totalEffort=lines.reduce((sum,line)=>sum+(line.crewDays??0),0);
 const known=current&&crewValid&&lines.length>0&&lines.every(line=>line.crewDays!==null)&&Number.isFinite(totalEffort)&&totalEffort<=Number.MAX_SAFE_INTEGER;
 const phaseDays=()=>['m','ea'].reduce((sum,unit)=>{const rows=lines.filter(line=>line.unit===unit);return sum+(rows.length?Math.max(1,Math.ceil(rows.reduce((effort,line)=>effort+line.crewDays!,0)-1e-9)):0);},0);
 return{current,lines,crewDays:known?lines.reduce((sum,line)=>sum+line.crewDays!,0):null,workDays:known?phaseDays():null,issues};
}

export interface ElectricalDemand {connectedWatts:number|null;diversifiedWatts:number|null;currentAmps:number|null;unknownLoadCount:number;formula:string;issues:string[]}
export const serviceCalculationReferences={electrical:'https://www.electrical-installation.org/enwiki/Definition_of_reactive_power',gradient:'https://openstax.org/books/intermediate-algebra-2e/pages/3-2-slope-of-a-line'} as const;
/** Single-phase real-power arithmetic; excludes protection, cable, fault, supply and earthing design. */
export function calculateElectricalDemand(plan:ServicePlan):ElectricalDemand {
 const loads=plan.points.filter(point=>['light','socket','equipment'].includes(point.kind));
 const unknownLoadCount=loads.filter(point=>!usable(point.loadWatts)).length;
 const {voltage,powerFactor,demandFactor}=plan.assumptions;
 const issues:string[]=[];
 if(unknownLoadCount)issues.push(`${unknownLoadCount} load point(s) lack connected wattage; demand and current are unknown, not zero.`);
 if(!loads.length)issues.push('No electrical load points are represented.');
 if(!positive(voltage)||!positive(powerFactor)||powerFactor>1||!usable(demandFactor)||demandFactor>1)issues.push('Voltage must be positive, power factor in (0,1], and demand factor in [0,1].');
 const connected=loads.reduce((sum,point)=>sum+(usable(point.loadWatts)?point.loadWatts:0),0);
 const connectedWatts=loads.length&&!unknownLoadCount&&Number.isFinite(connected)?connected:null;
 const diversifiedWatts=connectedWatts!==null&&!issues.length?connectedWatts*demandFactor:null;
 const rawCurrent=diversifiedWatts!==null?diversifiedWatts/(voltage*powerFactor):null;
 const currentAmps=rawCurrent!==null&&Number.isFinite(rawCurrent)?rawCurrent:null;
 if(rawCurrent!==null&&!Number.isFinite(rawCurrent))issues.push('Current arithmetic exceeds supported finite precision; revise the inputs.');
 issues.push('Formula source: single-phase real-power identity P = V × I × power factor, rearranged with user-entered demand factor. Concept demand only; no cable, breaker, earthing, fault-current or safety/compliance sizing.');
 return{connectedWatts,diversifiedWatts,currentAmps,unknownLoadCount,formula:`I = Σ connected watts × demand factor ÷ (voltage × power factor) = ${connectedWatts??'?'} × ${demandFactor} ÷ (${voltage} × ${powerFactor}) A`,issues};
}

export function calculateDrainageFall(lengthMetres:number,gradient:number):{fallMetres:number|null;formula:string;issues:string[]} {
 const valid=usable(lengthMetres)&&positive(gradient)&&Number.isFinite(lengthMetres/gradient);
 return{fallMetres:valid?lengthMetres/gradient:null,formula:`Vertical fall = horizontal run ÷ gradient denominator = ${lengthMetres} m ÷ ${gradient} (1:${gradient}).`,issues:[...(!valid?['Enter a finite non-negative horizontal run and positive gradient denominator.']:[]),'Arithmetic reference only. Enter horizontal run, not 3D centreline length. Gradient is a user assumption; no pipe sizing, flow capacity, route feasibility or statutory drainage compliance is inferred.']};
}

/** Service installation tasks for a NEW template only. Existing planner tasks are never rewritten here. */
export function serviceInstallationActivities(project:Project,roughInPredecessors:string[],fitOffPredecessors:string[]):ActivityDefinition[] {
 if(!project.services)return[];
 const programme=calculateServiceProgramme(project,project.services);
 const routes=programme.lines.filter(line=>line.unit==='m'),points=programme.lines.filter(line=>line.unit==='ea');
 const make=(id:string,name:string,lines:ServiceProgrammeLine[],predecessors:string[]):ActivityDefinition=>{
  const effort=lines.length&&lines.every(line=>line.crewDays!==null)?lines.reduce((sum,line)=>sum+line.crewDays!,0):null;
  return{id,name,category:'allowance',quantity:1,unit:'reviewed service package',productivity:effort!==null&&effort>0?1/effort:0,minDuration:1,predecessors,crewDemand:1,maxCrews:1,leadTime:0,quantityMode:'manual',productivityMode:'manual',servicePackage:id==='services-rough-in'?'routes':'points'};
 };
 return[...(routes.length?[make('services-rough-in','Concept service routes — entered productivity',routes,roughInPredecessors)]:[]),...(points.length?[make('services-fit-off','Concept service points — entered productivity',points,fitOffPredecessors)]:[])];
}
