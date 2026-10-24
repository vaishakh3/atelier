import type {DesignWorkbenchState} from './designWorkbench';
import type {SiteContext} from '../site/types';
import type {DesignLibrary} from '../model/authoring';
import type {ProjectViewState} from '../model/viewState';
import type {PlanningContext} from './planning';
import type {ServicePlan} from '../services/types';
export type ElementKind = 'wall' | 'slab' | 'door' | 'window' | 'room' | 'roof' | 'stair' | 'reference';
export type Role = 'admin' | 'editor' | 'contributor' | 'reviewer';
export type ViewMode = '3d' | 'plan' | 'section' | 'elevation';
export interface Level { id:string; name:string; elevation:number; }
export interface GridLine { id:string; axis:'x'|'y'; value:number; label:string; }
export interface BimElement { footprint?:{x:number;y:number}[]; id:string; externalId?:string; kind:ElementKind; name:string; levelId:string; typeId:string; material:string; x:number; y:number; z:number; width:number; depth:number; height:number; rotation:number; hostId?:string; editable:boolean; properties:Record<string,string|number|boolean>; }
export interface ElementType { id:string; name:string; kind:ElementKind; material:string; unit:'m²'|'m³'|'ea'|'m'; materialRate:number|null; labourRate:number|null; equipmentRate:number|null; wastePercent:number; approved:boolean; productivity:number; rateDate:string; rateCurrency?:'INR'|'USD'|'EUR'; rateSource?:string; }
export interface Allowance { id:string; name:string; amount:number|null; included:boolean; }
export interface ActivityDefinition { servicePackage?:'routes'|'points'; id:string; name:string; category:ElementKind|'allowance'; quantity:number; unit:string; productivity:number; minDuration:number; predecessors:string[]; crewDemand:number; maxCrews:number; leadTime:number; fixedDuration?:number; quantityMode?:'model'|'manual'; sourceElementIds?:string[]; productivityMode?:'type'|'manual'; }
export interface SequenceAlternative { id:string; name:string; approved:boolean; rationale:string; baselineSignature:string; predecessors:Record<string,string[]>; }
export interface ScheduleConfig { startDate:string; workingDays:number[]; crews:number; crewCostPerDay:number; overheadPerDay:number; procurementDays:number; activities:ActivityDefinition[]; holidays?:string[]; sequenceAlternatives?:SequenceAlternative[]; modelReview?:{modelSignature:string;activitySignature:string;acceptedAt:string}; modelReviewRequired?:boolean; }
export interface Constraints { budget:number|null; deadline:string|null; maxCrews:number; lockedElementIds:string[]; lockedProperties:string[]; }
export interface AuditEntry { id:string; actor:string; timestamp:string; action:string; affectedIds:string[]; }
export interface Project { workbench?:DesignWorkbenchState; site?:SiteContext; designLibrary?:DesignLibrary; viewState?:ProjectViewState; schemaVersion:1; id:string; name:string; description:string; location:string; units:'m'|'ft'; currency:'INR'|'USD'|'EUR'; version:number; createdAt:string; updatedAt:string; levels:Level[]; grids:GridLine[]; elements:BimElement[]; types:ElementType[]; allowances:Allowance[]; schedule:ScheduleConfig; constraints:Constraints; audit:AuditEntry[]; planning?:PlanningContext; services?:ServicePlan; }
export interface QuantityLine { elementId:string; name:string; kind:ElementKind; typeId:string; quantity:number; unit:string; formula:string; issues:string[]; }
export interface CostLine { id:string; name:string; sourceIds:string[]; quantity:number; unit:string; material:number|null; labour:number|null; equipment:number|null; waste:number; total:number|null; formula:string; rateDate:string; issues:string[]; rateCurrency?:'INR'|'USD'|'EUR'; rateSource?:string; }
export interface CostResult { lines:CostLine[]; material:number; labour:number; equipment:number; waste:number; allowances:number; overhead:number; total:number; completeness:number; issues:string[]; }
export interface ScheduledActivity extends ActivityDefinition { startDate:string; finishDate:string; startDay:number; finishDay:number; duration:number; assignedCrews:number; critical:boolean; }
export interface ScheduleResult { activities:ScheduledActivity[]; startDate:string; finishDate:string; durationDays:number; workingDays:number; feasible:boolean; issues:string[]; criticalPath:string[]; crewDays:number; }
export type Objective = 'tradeoffs'|'cost'|'time';
export interface Scenario { id:string; name:string; baselineVersion:number; changes:string[]; crews:number; procurementDays:number; typeChanges:Record<string,string>; cost:CostResult; schedule:ScheduleResult; feasible:boolean; reasons:string[]; dominated:boolean; sequenceAlternativeId?:string; sequenceChanges?:{activityId:string;before:string[];after:string[]}[]; sequenceRationale?:string; searchInfo?:{evaluated:number;totalCandidates:number;limit:number;truncated:boolean;approvedSequenceIds:string[]}; }
export interface ElementChange { elementId:string; before:Partial<BimElement>; after:Partial<BimElement>; }
export interface ElementCreation {elementId:string;before:null;after:BimElement}
export interface ElementRemoval {elementId:string;before:BimElement;after:null}
export interface LevelCreation {levelId:string;before:null;after:Level}
export interface RepetitionProposal {sourceIds:string[];count:number;offsetX:number;offsetY:number;idPrefix:string;sources:BimElement[]}
export type LayoutUse = 'bedroom'|'bathroom'|'living'|'kitchen'|'dining'|'theater'|'pool'|'study'|'utility'|'garage'|'other';
export interface LayoutRoom {key:string;name:string;use:LayoutUse;area:number|null;attachedTo:string|null;floor?:0|1|null}
export interface LayoutSpec {levelId:string;footprintId:string|null;width:number|null;depth:number|null;rooms:LayoutRoom[];storeys?:1|2|null;floorHeight?:number|null;replaceConcept?:boolean|null;variant?:'balanced'|'compact'|'daylight'|null}
export interface LayoutRequest extends LayoutSpec {idPrefix:string}
export interface LayoutProposal extends LayoutRequest {baselineVersion:number}
export type LocalRoomEditSpec = {action:'resize-room';roomId:string;targetArea:number} | {action:'replace-rooms';roomIds:string[];name:string;use:LayoutUse};
export type LocalRoomEditProposal = LocalRoomEditSpec & {baselineVersion:number;idPrefix:string};
export interface UpperFloorSpec {baseLevelId:string;rooms:LayoutRoom[];floorHeight:number|null}
export interface UpperFloorProposal extends UpperFloorSpec {baselineVersion:number;idPrefix:string}
export interface AiProposal { upperFloor?:UpperFloorProposal; localEdit?:LocalRoomEditProposal; roomResize?:{roomKey:string;roomName:string;sourceArea:number;targetArea:number}; id:string; prompt:string; summary:string; kind:'edit'|'analysis'|'schedule'|'repetition'|'layout'; changes:ElementChange[]; issues:string[]; selectedIds:string[]; model:string; createdAt:string; crewCount?:number; repetition?:RepetitionProposal;layout?:LayoutProposal;creations?:ElementCreation[];levelCreations?:LevelCreation[];removals?:ElementRemoval[]; }
export interface SavedVersion { id:string; label:string; actor:string; timestamp:string; project:Project; }
export interface ImportReport { schema:string; imported:number; referenceOnly:number; excluded:number; classes:{name:string; count:number; editable:number; referenceOnly:number}[]; warnings:string[]; source?:{schema:string;entityCount:number;lengthUnitScale:number;unitsDeclared:boolean}; }
export interface ReviewComment { id:string; versionId:string; author:string; text:string; createdAt:string; }
