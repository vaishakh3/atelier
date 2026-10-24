/** Concept services for coordination; engineering status is never inferred from a drawn route. */
export type ServiceSystem = 'electrical' | 'cold-water' | 'drainage';
export type ServicePointKind = 'light' | 'switch' | 'socket' | 'equipment' | 'panel' | 'water-inlet' | 'drain-outlet' | 'basin' | 'wc' | 'shower' | 'sink';
export interface ServiceVector {x:number;y:number;z:number}
export interface ServicePoint {
 id:string; name:string; kind:ServicePointKind; levelId:string; roomId?:string;
 /** Metres in the room's local axes, or world axes for an unhosted point. z is above level datum. */
 offset:ServiceVector; loadWatts:number|null; circuitId?:string;
}
export interface ServiceRoute {
 id:string; system:ServiceSystem; fromId:string; toId:string; points:ServiceVector[]; circuitId?:string;
}
export interface ServiceRate {
 key:string; name:string; unit:'ea'|'m'; material:number|null; labour:number|null;
 /** Installation output per crew-day, independent of rates. */
 productivity:number|null;
}
export interface ServiceAssumptions {
 currency:'INR'|'USD'|'EUR'; rateSource:string; rateDate:string;
 rates:ServiceRate[]; wastePercent:number; voltage:number; powerFactor:number; demandFactor:number;
 drainageGradient:number; workHoursPerDay:number; crews:number;
}
export interface ServicePlan {
 schemaVersion:1; status:'concept'; modelSignature:string;
 points:ServicePoint[]; routes:ServiceRoute[]; assumptions:ServiceAssumptions;
 notes:string[];
}
export interface ServiceIssue {id:string;severity:'review'|'error';message:string;sourceIds:string[]}
