import {z} from 'zod';
import type {BimElement,Project,ViewMode} from '../domain/types';
import {footprint,localToWorld} from './geometry';
import {placedAssetGeometry} from '../site/exchange';
export interface ViewVector {x:number;y:number;z:number}
export interface CameraSnapshot {position:[number,number,number];target:[number,number,number];up:[number,number,number]}
export interface PlanSnapshot {x:number;y:number;width:number;height:number;rotation?:number}
export interface SavedModelView {id:string;name:string;viewMode:ViewMode;levelId:string;hiddenIds:string[];isolatedIds:string[];contextHiddenIds?:string[];camera?:CameraSnapshot;plan?:PlanSnapshot}
export interface SnapSettings {enabled:boolean;grid:boolean;step:number;objects:boolean;axes:boolean}
export interface SectionBox {enabled:boolean;min:ViewVector;max:ViewVector}
export interface ProjectViewState {schemaVersion:1;savedViews:SavedModelView[];snapping:SnapSettings;sectionBox:SectionBox}
export type NavigationAction='align'|'look-from'|'north'|'measure'|'section-box';
export interface ViewContext {viewMode:ViewMode;levelId:string;hiddenIds:string[];isolatedIds:string[];contextHiddenIds?:string[]}
const finite=z.number().finite().min(-1e7).max(1e7),positive=z.number().finite().positive().max(2e7),vector=z.object({x:finite,y:finite,z:finite}).strict();
const tuple=z.tuple([finite,finite,finite]);
export const cameraSnapshotSchema=z.object({position:tuple,target:tuple,up:tuple}).strict().refine(camera=>Math.hypot(...camera.up)>1e-8&&Math.hypot(...camera.position.map((v,i)=>v-camera.target[i]))>1e-8&&Math.hypot((camera.target[1]-camera.position[1])*camera.up[2]-(camera.target[2]-camera.position[2])*camera.up[1],(camera.target[2]-camera.position[2])*camera.up[0]-(camera.target[0]-camera.position[0])*camera.up[2],(camera.target[0]-camera.position[0])*camera.up[1]-(camera.target[1]-camera.position[1])*camera.up[0])>1e-8,'Camera needs a non-zero, non-parallel up vector and distinct eye/target.');
export const planSnapshotSchema=z.object({x:finite,y:finite,width:positive,height:positive,rotation:z.number().finite().min(-360).max(360).optional()}).strict();
export const sectionBoxSchema=z.object({enabled:z.boolean(),min:vector,max:vector}).strict().refine(box=>box.max.x>box.min.x&&box.max.y>box.min.y&&box.max.z>box.min.z,'Section-box maximums must exceed minimums.');
export const viewStateSchema=z.object({schemaVersion:z.literal(1),savedViews:z.array(z.object({id:z.string().min(1).max(160),name:z.string().trim().min(1).max(120),viewMode:z.enum(['3d','plan','section','elevation']),levelId:z.string().min(1).max(160),hiddenIds:z.array(z.string().min(1).max(160)).max(10000),isolatedIds:z.array(z.string().min(1).max(160)).max(10000),contextHiddenIds:z.array(z.string().min(1).max(160)).max(10000).optional(),camera:cameraSnapshotSchema.optional(),plan:planSnapshotSchema.optional()}).strict().refine(view=>view.viewMode==='3d'?!!view.camera:!!view.plan,'A saved view must contain its camera or drawing frame.')).max(40),snapping:z.object({enabled:z.boolean(),grid:z.boolean(),step:z.number().finite().min(.001).max(100),objects:z.boolean(),axes:z.boolean()}).strict(),sectionBox:sectionBoxSchema}).strict().superRefine((state,ctx)=>{if(new Set(state.savedViews.map(view=>view.id)).size!==state.savedViews.length)ctx.addIssue({code:'custom',message:'Saved view IDs must be unique.'});});
export function siteViewVertices(project:Project):ViewVector[]{return [...(project.site?.terrain?.vertices??[]),...(project.site?.contexts??[]).flatMap(asset=>placedAssetGeometry(asset).vertices)];}
/** Bounds for inspection only; reference context never becomes measured BIM work. */
export function viewportWorldBounds(elements:BimElement[],context:ViewVector[]=[]){
 let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
 const include=(point:ViewVector)=>{if(![point.x,point.y,point.z].every(Number.isFinite))return;minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);minZ=Math.min(minZ,point.z);maxZ=Math.max(maxZ,point.z);};
 for(const element of elements)for(const point of footprint(element)){include({...point,z:element.z});include({...point,z:element.z+element.height});}
 for(const point of context)include(point);
 return Number.isFinite(minX)?{minX,minY,minZ,maxX,maxY,maxZ}:{minX:0,minY:0,minZ:0,maxX:12,maxY:9,maxZ:3};
}
export function defaultViewState(project:Project):ProjectViewState {
 const bounds=viewportWorldBounds(project.elements,siteViewVertices(project)),minZ=bounds.minZ;
 return{schemaVersion:1,savedViews:[],snapping:{enabled:true,grid:true,step:.25,objects:false,axes:false},sectionBox:{enabled:false,min:{x:bounds.minX-1,y:bounds.minY-1,z:minZ-1},max:{x:bounds.maxX+1,y:bounds.maxY+1,z:Math.max(minZ+1,bounds.maxZ+1)}}};
}
export function checkedViewState(project:Project):ProjectViewState {const parsed=viewStateSchema.safeParse(project.viewState);return parsed.success?parsed.data:defaultViewState(project);}
export function commitViewState(state:ProjectViewState,canEdit:boolean,onChange?:((state:ProjectViewState)=>void)):void {if(!canEdit||!onChange)throw new Error('Only an authorised project editor can save view settings.');onChange(viewStateSchema.parse(state));}
export function savedViewIssues(project:Project,view:SavedModelView):string[]{const issues:string[]=[];if(!project.levels.some(level=>level.id===view.levelId))issues.push('This saved view references a removed floor. Choose a current floor and save a replacement view.');if(view.viewMode==='3d'&&!cameraSnapshotSchema.safeParse(view.camera).success)issues.push('The saved camera is invalid.');if(view.viewMode!=='3d'&&!planSnapshotSchema.safeParse(view.plan).success)issues.push('The saved drawing frame is invalid.');return issues;}
export function sectionContainsPoint(box:SectionBox,point:ViewVector){return!box.enabled||point.x>=box.min.x&&point.x<=box.max.x&&point.y>=box.min.y&&point.y<=box.max.y&&point.z>=box.min.z&&point.z<=box.max.z;}
export function sectionIntersectsElement(box:SectionBox,element:BimElement):boolean {if(!box.enabled)return true;const points=footprint(element);return Math.max(...points.map(p=>p.x))>=box.min.x&&Math.min(...points.map(p=>p.x))<=box.max.x&&Math.max(...points.map(p=>p.y))>=box.min.y&&Math.min(...points.map(p=>p.y))<=box.max.y&&element.z+element.height>=box.min.z&&element.z<=box.max.z;}
export function measureDistance(a:ViewVector,b:ViewVector){return Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);}
export interface SnapResult {point:{x:number;y:number};source:'free'|'grid'|'object'|'axis';guides:{axis:'x'|'y';value:number}[]}
/** Metric coordinate snapping, independent of display units; screen-derived tolerance is supplied by the viewport. */
export function snapViewPoint(project:Project,raw:{x:number;y:number},settings:SnapSettings,options:{levelId:string;origin?:{x:number;y:number};excludeIds?:string[];tolerance?:number}):SnapResult {
 if(!settings.enabled)return{point:{...raw},source:'free',guides:[]};
 const tolerance=Math.max(.001,Math.min(2,options.tolerance??.15)),excluded=new Set(options.excludeIds??[]);
 const vertices=project.elements.filter(e=>e.levelId===options.levelId&&!excluded.has(e.id)).flatMap(footprint);
 if(settings.objects){const closest=vertices.map(point=>({point,d:Math.hypot(raw.x-point.x,raw.y-point.y)})).filter(item=>item.d<=tolerance).sort((a,b)=>a.d-b.d)[0];if(closest)return{point:{...closest.point},source:'object',guides:[{axis:'x',value:closest.point.x},{axis:'y',value:closest.point.y}]};}
 let point=settings.grid?{x:Math.round(raw.x/settings.step)*settings.step,y:Math.round(raw.y/settings.step)*settings.step}:{...raw};let source:SnapResult['source']=settings.grid?'grid':'free';const guides:SnapResult['guides']=[];
 if(settings.axes){const candidates=[...(options.origin?[options.origin]:[]),...vertices];for(const axis of ['x','y'] as const){const match=candidates.map(candidate=>({value:candidate[axis],d:Math.abs(raw[axis]-candidate[axis])})).filter(candidate=>candidate.d<=tolerance).sort((a,b)=>a.d-b.d)[0];if(match){point[axis]=match.value;guides.push({axis,value:match.value});source='axis';}}}
 return{point,source,guides};
}
/** A wall/facade normal expressed in Three coordinates; hosted openings align to their wall. */
export function facadeView(project:Project,selectedIds:string[]):{target:[number,number,number];normal:[number,number,number]}|null {
 const selected=selectedIds.map(id=>project.elements.find(e=>e.id===id)).find(Boolean),wall=selected?.kind==='wall'?selected:selected?.hostId?project.elements.find(e=>e.id===selected.hostId&&e.kind==='wall'):null;
 if(!wall)return null;const p=localToWorld(wall,wall.width/2,wall.depth/2),angle=wall.rotation*Math.PI/180;return{target:[p.x,wall.z+wall.height/2,p.y],normal:[-Math.sin(angle),0,Math.cos(angle)]};
}
