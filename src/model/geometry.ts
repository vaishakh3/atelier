import type { BimElement, ElementKind, Project } from '../domain/types';

export interface Point2 { x:number; y:number }
export interface ModelBounds { minX:number; minY:number; maxX:number; maxY:number; maxZ:number }
export interface WallSegment { x:number; width:number; bottom:number; height:number }
export interface GeometryIssue { code:string; severity:'error'|'warning'; elementIds:string[]; message:string }
export interface OpeningRectangle { elementId:string; left:number; right:number; bottom:number; top:number }

export const snap = (value:number, step = .25) => Math.round(value / step) * step;
export const radians = (degrees:number) => degrees * Math.PI / 180;
/** Perspective distance that keeps a bounding sphere inside both viewport axes. */
export function cameraFitDistance(radius:number,verticalFov:number,aspect:number,margin=1.2):number {
  const verticalHalf=radians(verticalFov)/2;
  const horizontalHalf=Math.atan(Math.tan(verticalHalf)*Math.max(.01,aspect));
  return radius/Math.sin(Math.min(verticalHalf,horizontalHalf))*margin;
}
export function localToWorld(element:Pick<BimElement,'x'|'y'|'rotation'>, x:number, y:number):Point2 {
  const angle = radians(element.rotation);
  return { x:element.x + x * Math.cos(angle) - y * Math.sin(angle), y:element.y + x * Math.sin(angle) + y * Math.cos(angle) };
}
export function worldToLocal(element:Pick<BimElement,'x'|'y'|'rotation'>, point:Point2):Point2 {
  const angle = radians(element.rotation), dx = point.x-element.x, dy = point.y-element.y;
  return { x:dx*Math.cos(angle)+dy*Math.sin(angle), y:-dx*Math.sin(angle)+dy*Math.cos(angle) };
}
export function footprint(element:BimElement):Point2[] {
  return (element.footprint??[{x:0,y:0},{x:element.width,y:0},{x:element.width,y:element.depth},{x:0,y:element.depth}]).map(({x,y})=>localToWorld(element,x,y));
}
export function modelBounds(elements:BimElement[]):ModelBounds {
  if (!elements.length) return {minX:0,minY:0,maxX:12,maxY:9,maxZ:3};
  const points = elements.flatMap(footprint);
  return {minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y)),maxZ:Math.max(...elements.map(e=>e.z+e.height))};
}
export function nearestHostWall(project:Project, point:Point2, levelId:string, maximumDistance = 1.2):{wall:BimElement; offset:number; distance:number}|null {
  let best:{wall:BimElement;offset:number;distance:number}|null = null;
  for (const wall of project.elements.filter(e=>e.kind==='wall'&&e.levelId===levelId&&e.editable)) {
    const local = worldToLocal(wall,point);
    const offset = Math.max(0,Math.min(wall.width,local.x));
    const distance = Math.hypot(local.x-offset,local.y-wall.depth/2);
    if (distance <= maximumDistance && (!best || distance<best.distance)) best={wall,offset,distance};
  }
  return best;
}

/** One shared clipped union rule drives wall rendering, measured area and geometry review. */
export function hostedOpeningGeometry(wall:BimElement,elements:BimElement[]):{rectangles:OpeningRectangle[];unionArea:number;issues:GeometryIssue[]} {
  const rectangles:OpeningRectangle[]=[],issues:GeometryIssue[]=[],tolerance=1e-5;
  for(const opening of elements.filter(e=>(e.kind==='door'||e.kind==='window')&&e.hostId===wall.id)) {
    const ids=[wall.id,opening.id];
    if(![opening.x,opening.y,opening.z,opening.width,opening.height,opening.depth,opening.rotation].every(Number.isFinite)||opening.width<=0||opening.height<=0||opening.depth<=0){issues.push({code:'opening-dimensions',severity:'error',elementIds:ids,message:`${opening.name}: invalid opening dimensions.`});continue;}
    const local=worldToLocal(wall,opening),angle=((opening.rotation-wall.rotation)%360+540)%360-180;
    if(opening.levelId!==wall.levelId)issues.push({code:'opening-level',severity:'error',elementIds:ids,message:`${opening.name}: opening and host wall must share the same level.`});
    if(Math.abs(angle)>.1||local.y< -Math.max(.15,wall.depth)||local.y>wall.depth+.15){issues.push({code:'opening-alignment',severity:'error',elementIds:ids,message:`${opening.name}: opening is not aligned with its host wall.`});continue;}
    const bottom=opening.z-wall.z,top=bottom+opening.height,right=local.x+opening.width;
    if(local.x< -tolerance||right>wall.width+tolerance||bottom< -tolerance||top>wall.height+tolerance)issues.push({code:'opening-bounds',severity:'error',elementIds:ids,message:`${opening.name}: opening extends outside host wall bounds; measurement is clipped to the host.`});
    const rectangle={elementId:opening.id,left:Math.max(0,local.x),right:Math.min(wall.width,right),bottom:Math.max(0,bottom),top:Math.min(wall.height,top)};
    if(rectangle.right>rectangle.left&&rectangle.top>rectangle.bottom)rectangles.push(rectangle);
  }
  for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
    const a=rectangles[i],b=rectangles[j];
    if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>tolerance&&Math.min(a.top,b.top)-Math.max(a.bottom,b.bottom)>tolerance)issues.push({code:'opening-overlap',severity:'error',elementIds:[wall.id,a.elementId,b.elementId],message:`Hosted openings ${a.elementId} and ${b.elementId} overlap; their union is deducted once.`});
  }
  const breaks=[...new Set(rectangles.flatMap(rectangle=>[rectangle.left,rectangle.right]))].sort((a,b)=>a-b);
  let unionArea=0;
  for(let i=0;i<breaks.length-1;i++){
    const x=breaks[i],right=breaks[i+1],mid=(x+right)/2;
    const intervals=rectangles.filter(rectangle=>rectangle.left<mid&&rectangle.right>mid).sort((a,b)=>a.bottom-b.bottom);
    let bottom=0,top=0,height=0;
    for(const interval of intervals){if(interval.bottom>top){height+=top-bottom;bottom=interval.bottom;top=interval.top;}else top=Math.max(top,interval.top);}
    height+=top-bottom;unionArea+=(right-x)*height;
  }
  return{rectangles,unionArea,issues};
}
export function validateModelGeometry(project:Project):GeometryIssue[] {
  const issues:GeometryIssue[]=[],byId=new Map(project.elements.map(element=>[element.id,element]));
  const children=new Map<string,BimElement[]>();
  for(const element of project.elements){
    if(![element.x,element.y,element.z,element.width,element.depth,element.height,element.rotation].every(Number.isFinite)||element.width<=0||element.depth<=0||element.height<=0)issues.push({code:'invalid-dimensions',severity:'error',elementIds:[element.id],message:`${element.name}: finite positive dimensions and finite coordinates are required.`});
    if(!project.levels.some(level=>level.id===element.levelId))issues.push({code:'missing-level',severity:'error',elementIds:[element.id],message:`${element.name}: building level does not exist.`});
    if(element.kind==='door'||element.kind==='window'){
      const host=element.hostId?byId.get(element.hostId):undefined;
      if(!host||host.kind!=='wall')issues.push({code:'missing-host',severity:'error',elementIds:[element.id],message:`${element.name}: opening requires a valid host wall.`});
      else children.set(host.id,[...(children.get(host.id)??[]),element]);
    }
  }
  for(const [id,openings]of children)issues.push(...hostedOpeningGeometry(byId.get(id)!,openings).issues);
  return issues;
}

/** Partition a wall around its hosted openings, retaining lintels and window sills. */
export function wallSegments(wall:BimElement, elements:BimElement[]):WallSegment[] {
  const openings=hostedOpeningGeometry(wall,elements).rectangles;
  const breaks=[...new Set([0,wall.width,...openings.flatMap(e=>[e.left,e.right])])].sort((a,b)=>a-b);
  const result:WallSegment[]=[];
  for(let i=0;i<breaks.length-1;i++) {
    const x=breaks[i],right=breaks[i+1],mid=(x+right)/2;
    const holes=openings.filter(o=>o.left<mid&&o.right>mid).sort((a,b)=>a.bottom-b.bottom);
    let bottom=0;
    for(const hole of holes) {
      if(hole.bottom>bottom) result.push({x,width:right-x,bottom,height:hole.bottom-bottom});
      bottom=Math.max(bottom,hole.top);
    }
    if(bottom<wall.height) result.push({x,width:right-x,bottom,height:wall.height-bottom});
  }
  return result;
}

export function createDrawnElement(project:Project, kind:ElementKind, start:Point2, end:Point2, levelId:string,options?:{snapStep?:number|null}):{element?:BimElement;error?:string} {
  const level=project.levels.find(l=>l.id===levelId)??project.levels[0];
  if(!level) return {error:'Add a building level before drawing.'};
  const type=project.types.find(t=>t.kind===kind);
  const base:BimElement={id:`${kind}-${crypto.randomUUID()}`,kind,name:`${kind[0].toUpperCase()+kind.slice(1)} ${project.elements.filter(e=>e.kind===kind).length+1}`,levelId:level.id,typeId:type?.id??'',material:type?.material??(kind==='window'?'Glazing':kind==='door'?'Timber':'Unspecified'),x:start.x,y:start.y,z:level.elevation,width:1,depth:1,height:1,rotation:0,editable:true,properties:{}};
  if(kind==='door'||kind==='window') {
    const host=nearestHostWall(project,end,levelId);
    if(!host) return {error:'Click within 1.2 m of an editable wall to place an opening.'};
    const width=Math.min(kind==='door'?.9:1.5,host.wall.width);
    const offset=Math.max(0,Math.min(host.wall.width-width,(options?.snapStep===null?host.offset-width/2:snap(host.offset-width/2,options?.snapStep??.25))));
    const point=localToWorld(host.wall,offset,0);
    return {element:{...base,...point,width,depth:host.wall.depth,height:kind==='door'?2.1:1.2,z:host.wall.z+(kind==='window'?.9:0),rotation:host.wall.rotation,hostId:host.wall.id}};
  }
  const dx=end.x-start.x,dy=end.y-start.y;
  if(kind==='wall') {
    const length=Math.hypot(dx,dy);
    if(length<.25) return {error:'Drag at least 0.25 m to draw a wall.'};
    return {element:{...base,width:Math.round(length*1000)/1000,depth:.2,height:2.9,rotation:Math.atan2(dy,dx)*180/Math.PI}};
  }
  const width=Math.abs(dx),depth=Math.abs(dy);
  if(width<.25||depth<.25) return {error:'Drag a rectangle at least 0.25 × 0.25 m.'};
  return {element:{...base,x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width,depth,height:kind==='room'?2.9:kind==='stair'?3.2:kind==='roof'?.25:.2,z:level.elevation+(kind==='roof'?2.9:kind==='slab'?-.2:0),properties:kind==='stair'?{steps:16}:kind==='room'?{use:'Unassigned'}:{}}};
}

export function formatDistance(value:number,units:'m'|'ft'='m'):string {
  return units==='ft'?`${(value*3.280839895).toFixed(2)} ft`:`${value.toFixed(2)} m`;
}
