export interface SiteVector {x:number;y:number;z:number}
export interface SitePlacement {upAxis?:'z'|'y';units:'m'|'mm'|'ft';scale:number;rotation:number;origin:SiteVector}
export interface SiteImportReport {accepted:number;excluded:number;warnings:string[];unitHint?:'m'|'mm'|'ft'}
export interface SiteContextAsset {
 id:string;name:string;format:'OBJ'|'DXF'|'image';source:string;placement:SitePlacement;
 /** Source coordinates. Faces are explicit triangles; lines preserve open/closed polylines. */
 vertices:SiteVector[];faces:number[][];lines:number[][];
 image?:{dataUrl:string;width:number;height:number};report:SiteImportReport;
}
export interface SiteTerrain {source:string;vertices:SiteVector[];faces:number[][]}
export interface SiteContext {
 schemaVersion:1;latitude:number|null;longitude:number|null;utcOffsetHours:number;
 /** Same convention as PlanningContext.northAngle: CCW from model +Y to true north. */
 trueNorthAngle:number;datumElevation:number;source:string;
 contexts:SiteContextAsset[];terrain:SiteTerrain|null;
}
export const emptySiteContext=():SiteContext=>({schemaVersion:1,latitude:null,longitude:null,utcOffsetHours:5.5,trueNorthAngle:0,datumElevation:0,source:'',contexts:[],terrain:null});
