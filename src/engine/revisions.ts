import type { BimElement, CostResult, ElementType, Project, QuantityLine, ScheduleResult } from '../domain/types';
import { quantities } from './quantities';
import { estimate } from './cost';
import { buildSchedule } from './schedule';

export interface RevisionFieldChange { field:string; before:unknown; after:unknown }
export interface ElementRevision {
  elementId:string; previousElementId?:string; externalId?:string; name:string; kind:BimElement['kind'];
  status:'added'|'removed'|'modified'; categories:('geometry'|'type'|'specification'|'identity')[];
  fields:RevisionFieldChange[]; before:BimElement|null; after:BimElement|null;
}
export interface TypeRevision { typeId:string; name:string; status:'added'|'removed'|'modified'; fields:RevisionFieldChange[]; before:ElementType|null; after:ElementType|null }
export interface QuantityRevision { elementId:string; previousElementId?:string; name:string; before:QuantityLine|null; after:QuantityLine|null; delta:number|null; unit:string; issues:string[] }
export interface RevisionComparison {
  from:{id:string;name:string;version:number;updatedAt:string;currency:Project['currency']};
  to:{id:string;name:string;version:number;updatedAt:string;currency:Project['currency']};
  summary:{added:number;removed:number;modified:number;geometry:number;types:number;specifications:number;rates:number};
  elementChanges:ElementRevision[]; typeChanges:TypeRevision[]; rateChanges:TypeRevision[];
  projectChanges:RevisionFieldChange[]; allowanceChanges:RevisionFieldChange[]; quantityChanges:QuantityRevision[];
  cost:{before:CostResult;after:CostResult;delta:number|null;knownSubtotalDelta:number|null;complete:boolean;currencyComparable:boolean;components:Record<'material'|'labour'|'equipment'|'waste'|'allowances'|'overhead',number|null>};
  schedule:{before:ScheduleResult;after:ScheduleResult;workingDaysDelta:number|null;calendarDaysDelta:number|null;finishDateDeltaDays:number|null;activityChanges:{id:string;name:string;status:'added'|'removed'|'modified';fields:RevisionFieldChange[]}[]};
  issues:string[];
}
const geometryFields=new Set(['x','y','z','width','depth','height','rotation','levelId','hostId','kind']);
const rateFields=new Set(['materialRate','labourRate','equipmentRate','wastePercent','rateDate','rateSource','rateCurrency']);
const rounded=(number:number)=>Math.round(number*1e6)/1e6;
function stable(value:unknown):string {
  if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value)??'undefined';
}
function fields(before:Record<string,unknown>,after:Record<string,unknown>,only?:string[]):RevisionFieldChange[] {
  return [...new Set(only??[...Object.keys(before),...Object.keys(after)])].sort().filter(key=>stable(before[key])!==stable(after[key])).flatMap(key=>{
    if(key==='properties')return fields((before[key]??{})as Record<string,unknown>,(after[key]??{})as Record<string,unknown>).map(change=>({...change,field:`properties.${change.field}`}));
    return[{field:key,before:before[key]??null,after:after[key]??null}];
  });
}
function uniqueExternal(elements:BimElement[]):Map<string,BimElement> {
  const count=new Map<string,number>();for(const element of elements)if(element.externalId)count.set(element.externalId,(count.get(element.externalId)??0)+1);
  return new Map(elements.filter(element=>element.externalId&&count.get(element.externalId)===1).map(element=>[element.externalId!,element]));
}

/** Detached deterministic comparison; unknown scope/currency changes never become invented savings. */
export function compareRevisions(before:Project,after:Project):RevisionComparison {
  const issues:string[]=[],beforeById=new Map(before.elements.map(element=>[element.id,element])),afterById=new Map(after.elements.map(element=>[element.id,element]));
  const beforeExternal=uniqueExternal(before.elements),afterExternal=uniqueExternal(after.elements);
  const pairs:{before:BimElement|null;after:BimElement|null}[]=[],matched=new Set<string>();
  for(const element of before.elements){
    const candidate=afterById.get(element.id)??(element.externalId&&beforeExternal.has(element.externalId)?afterExternal.get(element.externalId):undefined);
    if(candidate&&!matched.has(candidate.id)){pairs.push({before:element,after:candidate});matched.add(candidate.id);}else pairs.push({before:element,after:null});
  }
  for(const element of after.elements)if(!matched.has(element.id))pairs.push({before:null,after:element});
  if(before.elements.some(element=>element.externalId&&!beforeExternal.has(element.externalId))||after.elements.some(element=>element.externalId&&!afterExternal.has(element.externalId)))issues.push('Duplicate external IDs cannot establish a unique cross-import match; those elements use application IDs only.');
  const elementChanges:ElementRevision[]=[];
  for(const pair of pairs){
    const element=pair.after??pair.before!;
    const changes=pair.before&&pair.after?fields(pair.before as unknown as Record<string,unknown>,pair.after as unknown as Record<string,unknown>,['name','kind','levelId','typeId','material','x','y','z','width','depth','height','rotation','hostId','editable','properties']):[];
    if(pair.before&&pair.after&&!changes.length)continue;
    const categories=new Set<ElementRevision['categories'][number]>();
    for(const change of changes)categories.add(geometryFields.has(change.field)?'geometry':change.field==='typeId'?'type':change.field==='material'||change.field.startsWith('properties.')?'specification':'identity');
    if(!pair.before||!pair.after)categories.add('geometry');
    elementChanges.push({elementId:element.id,...(pair.before&&pair.before.id!==element.id?{previousElementId:pair.before.id}:{}),...(element.externalId?{externalId:element.externalId}:{}),name:element.name,kind:element.kind,status:!pair.before?'added':!pair.after?'removed':'modified',categories:[...categories],fields:changes,before:pair.before?structuredClone(pair.before):null,after:pair.after?structuredClone(pair.after):null});
  }
  const typeChanges:TypeRevision[]=[];
  const beforeTypes=new Map(before.types.map(type=>[type.id,type])),afterTypes=new Map(after.types.map(type=>[type.id,type]));
  for(const id of new Set([...beforeTypes.keys(),...afterTypes.keys()])){
    const previous=beforeTypes.get(id)??null,next=afterTypes.get(id)??null;
    const changes=fields((previous??{})as unknown as Record<string,unknown>,(next??{})as unknown as Record<string,unknown>);
    if(!changes.length)continue;
    typeChanges.push({typeId:id,name:(next??previous)!.name,status:!previous?'added':!next?'removed':'modified',fields:changes,before:previous?structuredClone(previous):null,after:next?structuredClone(next):null});
  }
  const rateChanges=typeChanges.filter(change=>change.fields.some(field=>rateFields.has(field.field))).map(change=>({...change,fields:change.fields.filter(field=>rateFields.has(field.field))}));
  const beforeQuantities=new Map(quantities(before).map(line=>[line.elementId,line])),afterQuantities=new Map(quantities(after).map(line=>[line.elementId,line]));
  const quantityChanges:QuantityRevision[]=[];
  for(const pair of pairs){
    const old=pair.before?beforeQuantities.get(pair.before.id)??null:null,next=pair.after?afterQuantities.get(pair.after.id)??null:null;
    if(old&&next&&old.quantity===next.quantity&&old.unit===next.unit&&old.formula===next.formula&&stable(old.issues)===stable(next.issues))continue;
    const comparable=!old||!next||old.unit===next.unit;
    quantityChanges.push({elementId:(pair.after??pair.before)!.id,...(pair.before&&pair.after&&pair.before.id!==pair.after.id?{previousElementId:pair.before.id}:{}),name:(next??old)!.name,before:old,after:next,delta:comparable?rounded((next?.quantity??0)-(old?.quantity??0)):null,unit:next?.unit??old!.unit,issues:comparable?[]:['Measurement units changed; quantities cannot be subtracted without an explicit conversion.']});
  }
  const beforeSchedule=buildSchedule(before),afterSchedule=buildSchedule(after),beforeCost=estimate(before,beforeSchedule),afterCost=estimate(after,afterSchedule);
  const currencyComparable=before.currency===after.currency,complete=beforeCost.completeness===100&&afterCost.completeness===100;
  if(!currencyComparable)issues.push(`Project currency changed from ${before.currency} to ${after.currency}; monetary deltas are unavailable without explicit conversion.`);
  if(!complete)issues.push('At least one estimate is incomplete. Known-subtotal deltas are provisional; a total-cost saving is not established.');
  const activityChanges:RevisionComparison['schedule']['activityChanges']=[];
  const aActivities=new Map(beforeSchedule.activities.map(activity=>[activity.id,activity])),bActivities=new Map(afterSchedule.activities.map(activity=>[activity.id,activity]));
  for(const id of new Set([...aActivities.keys(),...bActivities.keys()])){
    const old=aActivities.get(id),next=bActivities.get(id);
    const changes=fields((old??{})as unknown as Record<string,unknown>,(next??{})as unknown as Record<string,unknown>,['name','quantity','unit','productivity','duration','startDate','finishDate','assignedCrews','predecessors','critical']);
    if(changes.length)activityChanges.push({id,name:(next??old)!.name,status:!old?'added':!next?'removed':'modified',fields:changes});
  }
  const scheduleComparable=beforeSchedule.feasible&&afterSchedule.feasible;
  if(!scheduleComparable)issues.push('At least one schedule is infeasible; completion deltas are unavailable.');
  const components=Object.fromEntries((['material','labour','equipment','waste','allowances','overhead']as const).map(component=>[component,currencyComparable?rounded(afterCost[component]-beforeCost[component]):null])) as RevisionComparison['cost']['components'];
  return{from:{id:before.id,name:before.name,version:before.version,updatedAt:before.updatedAt,currency:before.currency},to:{id:after.id,name:after.name,version:after.version,updatedAt:after.updatedAt,currency:after.currency},summary:{added:elementChanges.filter(change=>change.status==='added').length,removed:elementChanges.filter(change=>change.status==='removed').length,modified:elementChanges.filter(change=>change.status==='modified').length,geometry:elementChanges.filter(change=>change.categories.includes('geometry')).length,types:elementChanges.filter(change=>change.categories.includes('type')).length,specifications:elementChanges.filter(change=>change.categories.includes('specification')).length,rates:rateChanges.length},elementChanges,typeChanges,rateChanges,projectChanges:fields(before as unknown as Record<string,unknown>,after as unknown as Record<string,unknown>,['name','description','location','planning','units','currency','levels','grids','constraints','schedule']),allowanceChanges:fields(Object.fromEntries(before.allowances.map(allowance=>[allowance.id,allowance])),Object.fromEntries(after.allowances.map(allowance=>[allowance.id,allowance]))),quantityChanges,cost:{before:beforeCost,after:afterCost,delta:currencyComparable&&complete?rounded(afterCost.total-beforeCost.total):null,knownSubtotalDelta:currencyComparable?rounded(afterCost.total-beforeCost.total):null,complete,currencyComparable,components},schedule:{before:beforeSchedule,after:afterSchedule,workingDaysDelta:scheduleComparable?afterSchedule.workingDays-beforeSchedule.workingDays:null,calendarDaysDelta:scheduleComparable?afterSchedule.durationDays-beforeSchedule.durationDays:null,finishDateDeltaDays:scheduleComparable?Math.round((Date.parse(afterSchedule.finishDate)-Date.parse(beforeSchedule.finishDate))/86_400_000):null,activityChanges},issues};
}
