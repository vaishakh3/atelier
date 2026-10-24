/** Project-team inputs for preliminary checks. No jurisdiction is inferred from a place name. */
export type KeralaAuthorityType = 'municipality'|'corporation'|'panchayat'|'unconfirmed';
export type PlanningMetric = 'front-setback'|'rear-setback'|'left-setback'|'right-setback'|'coverage'|'floor-area-ratio'|'height'|'storeys';
export type CompassSector = 'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW'|'centre';
export interface SitePlot {x:number;y:number;width:number;depth:number;rotation:number}
export interface PlanningRule {id:string;metric:PlanningMetric;limit:number;clause:string}
export interface RuleSource {
 title:string;url:string;version:string;effectiveFrom:string;reviewedOn:string;
 country:string;region:string;authority:string;authorityType:KeralaAuthorityType;applicability:string;confirmedBy:string;
 amendmentsChecked?:boolean;worksheet?:'kerala-a1-2025';panchayatCategory?:'I'|'II';
}
export interface VaastuPreference {id:string;target:'kitchen'|'bedroom'|'bathroom'|'living'|'study'|'entrance'|'stair';mode:'prefer'|'avoid';sectors:CompassSector[]}
export interface PlanningContext {
 country:string;region:string;authority:string;authorityType:KeralaAuthorityType;occupancy:'single-family-residential';
 plot:SitePlot|null;frontBoundary:'south'|'north'|'west'|'east';northAngle:number|null;
 groundElevation:number|null;roadWidth:number|null;notes:string;
 panchayatCategory?:'I'|'II'|'unconfirmed';
 ruleSource:RuleSource;rules:PlanningRule[];vaastu:{enabled:boolean;preferences:VaastuPreference[]};
}
export const planningMetricLabels:Record<PlanningMetric,string>={
 'front-setback':'Minimum front setback','rear-setback':'Minimum rear setback',
 'left-setback':'Minimum left setback','right-setback':'Minimum right setback',
 coverage:'Maximum ground coverage','floor-area-ratio':'Maximum floor area ratio',height:'Maximum model height',storeys:'Maximum modelled storeys',
};
export const planningMetricUnits:Record<PlanningMetric,string>={
 'front-setback':'m','rear-setback':'m','left-setback':'m','right-setback':'m',coverage:'%',
 'floor-area-ratio':'ratio',height:'m',storeys:'storeys',
};
export const compassSectors:CompassSector[]=['N','NE','E','SE','S','SW','W','NW','centre'];
export function emptyPlanningContext():PlanningContext{return{
 country:'India',region:'Kerala',authority:'',authorityType:'unconfirmed',occupancy:'single-family-residential',plot:null,frontBoundary:'south',northAngle:null,
 groundElevation:null,roadWidth:null,notes:'',panchayatCategory:'unconfirmed',
 ruleSource:{title:'',url:'',version:'',effectiveFrom:'',reviewedOn:'',country:'',region:'',authority:'',authorityType:'unconfirmed',applicability:'',confirmedBy:'',amendmentsChecked:false},
 rules:[],vaastu:{enabled:false,preferences:[]},
};}
/** Imported geometry/source metadata needs renewed applicability review in this workspace. */
export function resetPlanningApprovalForImport(planning:PlanningContext):PlanningContext{
 return{...planning,ruleSource:{...planning.ruleSource,amendmentsChecked:false,confirmedBy:''}};
}
