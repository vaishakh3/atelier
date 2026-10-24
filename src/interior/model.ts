import type {BimElement,Project} from '../domain/types';
import {footprint,localToWorld,worldToLocal,type Point2} from '../model/geometry';
import {FURNITURE_CATALOG,INTERIOR_STYLES} from './catalog';
import {furniturePlacementSchema,interiorStateSchema} from './schema';
import type {FurnitureAsset,FurnitureCategory,FurniturePlacement,InteriorState} from './types';
const EPS=1e-6;
type InteriorProject=Project&{interior?:InteriorState};
export function interiorState(project:Project):InteriorState {return structuredClone((project as InteriorProject).interior??{schemaVersion:1,styleId:'japandi',placements:[],references:[]});}
const assetFor=(placement:FurniturePlacement)=>FURNITURE_CATALOG.find(asset=>asset.id===placement.assetId);
export function furnitureFootprint(placement:FurniturePlacement):Point2[] {const asset=assetFor(placement);if(!asset)return[];return[{x:-asset.width/2,y:-asset.depth/2},{x:asset.width/2,y:-asset.depth/2},{x:asset.width/2,y:asset.depth/2},{x:-asset.width/2,y:asset.depth/2}].map(point=>localToWorld(placement,point.x,point.y));}
const cross=(a:Point2,b:Point2,c:Point2)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const onSegment=(p:Point2,a:Point2,b:Point2)=>Math.abs(cross(a,b,p))<EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS;
function inside(point:Point2,polygon:Point2[]):boolean {let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if(onSegment(point,a,b))return true;if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
function crosses(a:Point2,b:Point2,c:Point2,d:Point2):boolean{return cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS;}
/** Rectangles are convex. SAT also treats touching outer edges as non-overlap. */
function overlap(a:Point2[],b:Point2[],gap=0):boolean {for(const polygon of [a,b])for(let i=0;i<polygon.length;i++){const p=polygon[i],q=polygon[(i+1)%polygon.length],length=Math.hypot(q.x-p.x,q.y-p.y);if(length<EPS)continue;const nx=-(q.y-p.y)/length,ny=(q.x-p.x)/length,aa=a.map(v=>v.x*nx+v.y*ny),bb=b.map(v=>v.x*nx+v.y*ny);if(Math.max(...aa)+gap<=Math.min(...bb)+EPS||Math.max(...bb)+gap<=Math.min(...aa)+EPS)return false;}return true;}
function contained(points:Point2[],boundary:Point2[]):boolean {if(points.some(p=>!inside(p,boundary)))return false;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(!inside({x:(a.x+b.x)/2,y:(a.y+b.y)/2},boundary))return false;for(let j=0;j<boundary.length;j++)if(crosses(a,b,boundary[j],boundary[(j+1)%boundary.length]))return false;}return true;}
const verticalOverlap=(element:BimElement,base:number,height:number)=>Math.min(element.z+element.height,base+height)-Math.max(element.z,base)>EPS;
/** A conservative full-radius doorway keep-clear proxy; not a solved hinged swing or accessibility route. */
function doorBlocked(placement:FurniturePlacement,asset:FurnitureAsset,door:BimElement):boolean {const centre=localToWorld(door,door.width/2,door.depth/2),p=worldToLocal(placement,centre),dx=Math.max(0,Math.abs(p.x)-asset.width/2),dy=Math.max(0,Math.abs(p.y)-asset.depth/2);return Math.hypot(dx,dy)<door.width+.15-EPS;}
export function furnitureFit(project:Project,placement:FurniturePlacement,others?:FurniturePlacement[]):{valid:boolean;issues:string[];warnings:string[]} {
 const issues:string[]=[],warnings=['Placement uses outer-dimension proxies; verify usable circulation, exact door swings, drawers, installation and delivery access.'];
 const parsed=furniturePlacementSchema.safeParse(placement);if(!parsed.success)return{valid:false,issues:parsed.error.issues.map(issue=>issue.message),warnings};
 const asset=assetFor(placement)!,room=project.elements.find(e=>e.id===placement.roomId&&e.kind==='room'),level=project.levels.find(level=>level.id===placement.levelId);
 if(!room||!level||room.levelId!==placement.levelId)return{valid:false,issues:['Choose an existing room and its own building level.'],warnings};
 const nextLevel=project.levels.filter(l=>l.elevation>room.z+EPS).sort((a,b)=>a.elevation-b.elevation)[0],boundary=footprint(room),bounds={x0:Math.min(...boundary.map(p=>p.x))-.3,x1:Math.max(...boundary.map(p=>p.x))+.3,y0:Math.min(...boundary.map(p=>p.y))-.3,y1:Math.max(...boundary.map(p=>p.y))+.3};
 // Native generated rooms are 2 cm area markers, not ceiling-height volumes.
 const nearbyWalls=project.elements.filter(e=>e.levelId===room.levelId&&e.kind==='wall'&&e.height>=1.8&&e.z<=room.z+.3&&e.z+e.height>room.z+1.8).filter(e=>{const points=footprint(e);return Math.max(...points.map(p=>p.x))>=bounds.x0&&Math.min(...points.map(p=>p.x))<=bounds.x1&&Math.max(...points.map(p=>p.y))>=bounds.y0&&Math.min(...points.map(p=>p.y))<=bounds.y1;});
 const declared=Number(room.properties.ceilingHeight),roomHeight=Number.isFinite(declared)&&declared>.1?declared:room.height>.1?room.height:nearbyWalls.length?Math.min(...nearbyWalls.map(w=>w.z+w.height-room.z)):nextLevel?nextLevel.elevation-room.z:2.8,clearHeight=Math.min(roomHeight,nextLevel?nextLevel.elevation-room.z:Infinity);
 if(room.height<=.1&&!(Number.isFinite(declared)&&declared>.1))warnings.push(nearbyWalls.length?'Room is an area marker; nominal height is derived from nearby full-height walls, not a surveyed ceiling.':nextLevel?'Room is an area marker; height is bounded by the next storey. Ceiling buildup is not surveyed.':'Room is an area marker without a known ceiling; 2.8 m nominal height is assumed for this fit check.');
 if(asset.height>clearHeight+EPS)issues.push(`${asset.name} exceeds the room height.`);
 const points=furnitureFootprint(placement),roomPoints=footprint(room);if(!contained(points,roomPoints))issues.push(`${asset.name} extends outside ${room.name}. Choose a smaller item or another position.`);
 for(const obstacle of project.elements.filter(e=>e.levelId===placement.levelId&&['wall','stair','reference'].includes(e.kind)&&verticalOverlap(e,room.z,asset.height))){if(overlap(points,footprint(obstacle)))issues.push(`${asset.name} intersects ${obstacle.name}.`);}
 for(const door of project.elements.filter(e=>e.levelId===placement.levelId&&e.kind==='door'&&verticalOverlap(e,room.z,asset.height))){if(doorBlocked(placement,asset,door))issues.push(`${asset.name} blocks the conservative doorway clearance at ${door.name}.`);}
 for(const other of others??interiorState(project).placements){if(other.id===placement.id||other.levelId!==placement.levelId)continue;const otherAsset=assetFor(other);if(otherAsset&&overlap(points,furnitureFootprint(other)))issues.push(`${asset.name} overlaps ${otherAsset.name}.`);}
 return{valid:issues.length===0,issues:[...new Set(issues)],warnings};
}
function unlocked(project:Project,roomIds:string[]):void {if(project.constraints.lockedProperties.some(key=>['interior','interior.*','furniture','furniture.*','geometry','geometry.*','elements','elements.*','*'].includes(key))||roomIds.some(id=>project.constraints.lockedElementIds.includes(id)))throw new Error('Interior placement in this room is locked.');}
function changed(project:Project,state:InteriorState):Project {interiorStateSchema.parse(state);return{...project,interior:structuredClone(state)} as InteriorProject;}
export function createFurniturePlacement(project:Project,placement:FurniturePlacement):Project {const state=interiorState(project);if(state.placements.some(item=>item.id===placement.id))throw new Error('Furniture placement ID already exists.');unlocked(project,[placement.roomId]);const result=furnitureFit(project,placement);if(!result.valid)throw new Error(result.issues.join(' '));return changed(project,{...state,placements:[...state.placements,structuredClone(placement)]});}
export function updateFurniturePlacement(project:Project,id:string,patch:Partial<Omit<FurniturePlacement,'id'>>):Project {const state=interiorState(project),before=state.placements.find(item=>item.id===id);if(!before)throw new Error('Furniture placement does not exist.');const next={...before,...patch,id};unlocked(project,[before.roomId,next.roomId]);const result=furnitureFit(project,next);if(!result.valid)throw new Error(result.issues.join(' '));return changed(project,{...state,placements:state.placements.map(item=>item.id===id?next:item)});}
export function removeFurniturePlacement(project:Project,id:string):Project {const state=interiorState(project),before=state.placements.find(item=>item.id===id);if(!before)throw new Error('Furniture placement does not exist.');unlocked(project,[before.roomId]);return changed(project,{...state,placements:state.placements.filter(item=>item.id!==id)});}
function candidates(room:BimElement,asset:FurnitureAsset,existing:FurniturePlacement[],seed:string):FurniturePlacement[]{
 const result:FurniturePlacement[]=[];
 for(const turn of [0,90,180,270]){const swap=turn===90||turn===270,w=swap?asset.depth:asset.width,d=swap?asset.width:asset.depth,minX=w/2+.14,maxX=room.width-w/2-.14,minY=d/2+.14,maxY=room.depth-d/2-.14;if(maxX<minX||maxY<minY)continue;
  // Wall-biased candidates preserve the central space before searching the grid.
  const positions:Point2[]=[{x:(minX+maxX)/2,y:maxY},{x:minX,y:maxY},{x:maxX,y:maxY},{x:minX,y:(minY+maxY)/2},{x:maxX,y:(minY+maxY)/2},{x:(minX+maxX)/2,y:minY},{x:(minX+maxX)/2,y:(minY+maxY)/2}];
  for(let y=minY;y<=maxY+EPS&&positions.length<1000;y+=.35)for(let x=minX;x<=maxX+EPS&&positions.length<1000;x+=.35)positions.push({x,y});
  for(const p of positions.slice(0,1000)){const world=localToWorld(room,p.x,p.y),placement={id:seed,assetId:asset.id,roomId:room.id,levelId:room.levelId,x:world.x,y:world.y,rotation:room.rotation+turn};if(existing.some(item=>item.levelId===room.levelId&&assetFor(item)&&overlap(furnitureFootprint(placement),furnitureFootprint(item),.35)))continue;result.push(placement);}
 }return result;
}
function roomCategories(room:BimElement):FurnitureCategory[]{const use=String(room.properties.use??room.name).toLowerCase();if(/bedroom|bed room/.test(use))return['bed','table','cabinet'];if(/study|office|library/.test(use))return['desk','chair','cabinet'];if(/dining/.test(use))return['table','chair','chair'];if(/living|theat(er|re)|lounge/.test(use))return['sofa','table','chair'];return[];}
/** Deterministic bounded, style-ranked fit suggestions. Existing items and all architecture are retained. */
export function suggestRoomArrangement(project:Project,roomId:string,styleId:string):{placements:FurniturePlacement[];issues:string[];notes:string[]} {
 const room=project.elements.find(e=>e.id===roomId&&e.kind==='room'),notes=['Source-linked schematic furniture; manufacturer stock and delivery are not verified.','Outer dimensions and conservative doorway clearance are checked. Full circulation, access and installation need review. Existing furniture is retained.'],placements:FurniturePlacement[]=[],issues:string[]=[];
 if(!room)return{placements,issues:['Choose an existing room.'],notes};if(!INTERIOR_STYLES.some(style=>style.id===styleId))return{placements,issues:['Choose a supported style.'],notes};
 try{unlocked(project,[roomId]);}catch(error){return{placements,issues:[error instanceof Error?error.message:'Room is locked.'],notes};}
 const existing=interiorState(project).placements,occupied=[...existing],categories=roomCategories(room),present=new Map<FurnitureCategory,number>();for(const item of existing.filter(p=>p.roomId===roomId)){const asset=assetFor(item);if(asset)present.set(asset.category,(present.get(asset.category)??0)+1);}
 if(!categories.length)return{placements,issues:['No automatic furniture recipe is defined for this room use. Add sourced items from the library.'],notes};
 for(let i=0;i<categories.length;i++){const category=categories[i],count=present.get(category)??0;if(count>0){present.set(category,count-1);continue;}let assets=FURNITURE_CATALOG.filter(asset=>asset.category===category).sort((a,b)=>Number(b.styles.includes(styleId))-Number(a.styles.includes(styleId))||b.width*b.depth-a.width*a.depth);
  if(category==='table'&&!/dining/.test(String(room.properties.use??room.name).toLowerCase()))assets=assets.filter(asset=>asset.height<.6);
  let found:FurniturePlacement|undefined;const idBase=`interior-${room.id}-${category}-${i}`;let id=idBase,n=1;while(occupied.some(item=>item.id===id))id=`${idBase}-${n++}`;
  for(const asset of assets){found=candidates(room,asset,occupied,id).find(placement=>furnitureFit(project,placement,occupied).valid);if(found){if(asset!==assets[0])notes.push(`Selected ${asset.name} at its listed size because the preferred item did not fit.`);break;}}
  if(found){placements.push(found);occupied.push(found);}else issues.push(`No source-linked ${category} fits the remaining space without a clash. Omitted; no item was resized.`);
 }
 return{placements,issues,notes};
}
