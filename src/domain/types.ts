export type ElementKind = 'wall' | 'slab' | 'door' | 'window' | 'room' | 'roof' | 'stair' | 'reference';
export type Role = 'admin' | 'editor' | 'contributor' | 'reviewer';
export type ViewMode = '3d' | 'plan' | 'section' | 'elevation';
export interface Level { id:string; name:string; elevation:number; }
export interface GridLine { id:string; axis:'x'|'y'; value:number; label:string; }
export interface BimElement { id:string; externalId?:string; kind:ElementKind; name:string; levelId:string; typeId:string; material:string; x:number; y:number; z:number; width:number; depth:number; height:number; rotation:number; hostId?:string; editable:boolean; properties:Record<string,string|number|boolean>; }
export interface ElementType { id:string; name:string; kind:ElementKind; material:string; unit:'m²'|'m³'|'ea'|'m'; materialRate:number|null; labourRate:number|null; equipmentRate:number|null; wastePercent:number; approved:boolean; productivity:number; rateDate:string; }
export interface Allowance { id:string; name:string; amount:number|null; included:boolean; }
export interface ActivityDefinition { id:string; name:string; category:ElementKind|'allowance'; quantity:number; unit:string; productivity:number; minDuration:number; predecessors:string[]; crewDemand:number; maxCrews:number; leadTime:number; fixedDuration?:number; quantityMode?:'model'|'manual'; sourceElementIds?:string[]; productivityMode?:'type'|'manual'; }
export interface ScheduleConfig { startDate:string; workingDays:number[]; crews:number; crewCostPerDay:number; overheadPerDay:number; procurementDays:number; activities:ActivityDefinition[]; }
export interface Constraints { budget:number|null; deadline:string|null; maxCrews:number; lockedElementIds:string[]; lockedProperties:string[]; }
export interface AuditEntry { id:string; actor:string; timestamp:string; action:string; affectedIds:string[]; }
export interface Project { schemaVersion:1; id:string; name:string; description:string; location:string; units:'m'|'ft'; currency:'INR'|'USD'|'EUR'; version:number; createdAt:string; updatedAt:string; levels:Level[]; grids:GridLine[]; elements:BimElement[]; types:ElementType[]; allowances:Allowance[]; schedule:ScheduleConfig; constraints:Constraints; audit:AuditEntry[]; }
export interface QuantityLine { elementId:string; name:string; kind:ElementKind; typeId:string; quantity:number; unit:string; formula:string; issues:string[]; }
export interface CostLine { id:string; name:string; sourceIds:string[]; quantity:number; unit:string; material:number|null; labour:number|null; equipment:number|null; waste:number; total:number|null; formula:string; rateDate:string; issues:string[]; }
export interface CostResult { lines:CostLine[]; material:number; labour:number; equipment:number; waste:number; allowances:number; overhead:number; total:number; completeness:number; issues:string[]; }
export interface ScheduledActivity extends ActivityDefinition { startDate:string; finishDate:string; startDay:number; finishDay:number; duration:number; assignedCrews:number; critical:boolean; }
export interface ScheduleResult { activities:ScheduledActivity[]; startDate:string; finishDate:string; durationDays:number; workingDays:number; feasible:boolean; issues:string[]; criticalPath:string[]; crewDays:number; }
export type Objective = 'tradeoffs'|'cost'|'time';
export interface Scenario { id:string; name:string; baselineVersion:number; changes:string[]; crews:number; procurementDays:number; typeChanges:Record<string,string>; cost:CostResult; schedule:ScheduleResult; feasible:boolean; reasons:string[]; dominated:boolean; }
export interface ElementChange { elementId:string; before:Partial<BimElement>; after:Partial<BimElement>; }
export interface AiProposal { id:string; prompt:string; summary:string; kind:'edit'|'analysis'|'schedule'; changes:ElementChange[]; issues:string[]; selectedIds:string[]; model:string; createdAt:string; crewCount?:number; }
export interface SavedVersion { id:string; label:string; actor:string; timestamp:string; project:Project; }
export interface ImportReport { schema:string; imported:number; referenceOnly:number; excluded:number; classes:{name:string; count:number; editable:number; referenceOnly:number}[]; warnings:string[]; }
export interface ReviewComment { id:string; versionId:string; author:string; text:string; createdAt:string; }
