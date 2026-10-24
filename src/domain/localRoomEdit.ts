import type {BimElement,ElementChange,ElementCreation,ElementRemoval,LocalRoomEditSpec,LocalRoomEditProposal,Project} from './types';
import {footprint,localToWorld,worldToLocal,validateModelGeometry} from '../model/geometry';

export interface LocalRoomEditPreview {changes:ElementChange[];creations:ElementCreation[];removals:ElementRemoval[];issues:string[];notes:string[]}
type Rect={x0:number;y0:number;x1:number;y1:number};
type Frame=Pick<BimElement,'x'|'y'|'rotation'>;
type Join={axis:'x'|'y';sign:1|-1;gap:number;start:number;end:number;at:number};
const EPS=1e-5,MIN_WALL=.025;
const empty=(issue:string):LocalRoomEditPreview=>({changes:[],creations:[],removals:[],issues:[issue],notes:[]});
const angle=(n:number)=>((n%360)+360)%360;
const near=(a:number,b:number)=>Math.abs(a-b)<EPS;
const width=(r:Rect)=>r.x1-r.x0,depth=(r:Rect)=>r.y1-r.y0,area=(r:Rect)=>width(r)*depth(r);
const overlap=(a:Rect,b:Rect)=>Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0)>EPS&&Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)>EPS;
function rect(e:BimElement,frame:Frame):Rect {const points=footprint(e).map(p=>worldToLocal(frame,p));return{x0:Math.min(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),x1:Math.max(...points.map(p=>p.x)),y1:Math.max(...points.map(p=>p.y))};}
function withRect(e:BimElement,r:Rect,frame:Frame):BimElement {
 const a=angle(e.rotation-frame.rotation),vertical=near(a,90)||near(a,270);
 if(![0,90,180,270].some(value=>near(a,value)))throw new Error(`${e.name}: non-orthogonal geometry cannot be edited locally.`);
 const point=localToWorld(frame,near(a,0)?r.x0:near(a,90)||near(a,180)?r.x1:r.x0,near(a,0)||near(a,90)?r.y0:r.y1);
 return{...e,...point,width:vertical?depth(r):width(r),depth:vertical?width(r):depth(r)};
}
function join(a:Rect,b:Rect):Join|null {
 if(near(a.y0,b.y0)&&near(a.y1,b.y1)){
  if(b.x0-a.x1>=MIN_WALL&&b.x0-a.x1<=.6)return{axis:'x',sign:1,gap:b.x0-a.x1,start:a.y0,end:a.y1,at:(a.x1+b.x0)/2};
  if(a.x0-b.x1>=MIN_WALL&&a.x0-b.x1<=.6)return{axis:'x',sign:-1,gap:a.x0-b.x1,start:a.y0,end:a.y1,at:(a.x0+b.x1)/2};
 }
 if(near(a.x0,b.x0)&&near(a.x1,b.x1)){
  if(b.y0-a.y1>=MIN_WALL&&b.y0-a.y1<=.6)return{axis:'y',sign:1,gap:b.y0-a.y1,start:a.x0,end:a.x1,at:(a.y1+b.y0)/2};
  if(a.y0-b.y1>=MIN_WALL&&a.y0-b.y1<=.6)return{axis:'y',sign:-1,gap:a.y0-b.y1,start:a.x0,end:a.x1,at:(a.y0+b.y1)/2};
 }return null;
}
function native(e:BimElement,generation:string){return e.editable&&!e.externalId&&e.kind!=='reference'&&e.properties.conceptLayout===true&&e.properties.conceptGeneration===generation;}
function locked(project:Project,e:BimElement,after?:BimElement){
 if(project.constraints.lockedElementIds.includes(e.id))return true;
 const fields=after?Object.keys(e).filter(key=>JSON.stringify(e[key as keyof BimElement])!==JSON.stringify(after[key as keyof BimElement])):Object.keys(e);
 const all=['*','elements','elements.*','model.elements','model.elements.*',`${e.id}.*`,`elements.${e.id}`,`elements.${e.id}.*`,`model.elements.${e.id}`,`model.elements.${e.id}.*`];
 if(fields.some(field=>['x','y','width','depth','rotation','footprint'].includes(field)))fields.push('geometry','geometry.*','position','position.*','dimensions','dimensions.*');
 if(fields.includes('properties')){for(const key of new Set([...Object.keys(e.properties),...Object.keys(after?.properties??{})]))if(!after||e.properties[key]!==after.properties[key])fields.push(`properties.${key}`,key);fields.push('properties.*');}
 return project.constraints.lockedProperties.some(lock=>all.includes(lock)||fields.some(field=>[field,`model.${field}`,`${e.id}.${field}`,`elements.${field}`,`elements.${e.id}.${field}`,`elements.*.${field}`,`model.elements.${field}`,`model.elements.${e.id}.${field}`,`model.elements.*.${field}`].includes(lock)));
}
function donorFits(e:BimElement,r:Rect){
 const use=e.properties.use;if(use==='circulation'||String(e.properties.layoutKey).startsWith('@'))return Math.min(width(r),depth(r))>=1.2-EPS;
 if(use==='bathroom')return Math.min(width(r),depth(r))>=1.2-EPS&&area(r)>=2.4-EPS;
 if(use==='utility')return Math.min(width(r),depth(r))>=1.2-EPS&&area(r)>=2-EPS;
 return Math.min(width(r),depth(r))>=2.4-EPS&&area(r)>=9-EPS;
}
function geometrySame(a:Rect,b:Rect){return near(a.x0,b.x0)&&near(a.y0,b.y0)&&near(a.x1,b.x1)&&near(a.y1,b.y1);}

export function previewLocalRoomEdit(project:Project,spec:LocalRoomEditSpec|LocalRoomEditProposal):LocalRoomEditPreview {
 try{
  if('baselineVersion'in spec&&spec.baselineVersion!==project.version)return empty('The model changed after this local room preview. Generate a fresh preview.');
  const ids=spec.action==='resize-room'?[spec.roomId]:spec.roomIds;
  if(ids.length!==(spec.action==='resize-room'?1:2)||new Set(ids).size!==ids.length)return empty('Choose exactly one room to resize or exactly two distinct adjacent rooms to replace.');
  const rooms=ids.map(id=>project.elements.find(e=>e.id===id));
  if(rooms.some(e=>!e||e.kind!=='room'))return empty('Every selected source must be an existing room.');
  const first=rooms[0]!,generation=first.properties.conceptGeneration;
  if(typeof generation!=='string'||rooms.some(e=>!native(e!,generation)||e!.footprint||!near(angle(e!.rotation-first.rotation),0)||e!.levelId!==first.levelId||!near(e!.z,first.z)))return empty('Local room edits require native editable rectangular rooms on one floor with a common orientation. Imported, polygon, mixed-building and mixed-floor rooms are not supported.');
  if(rooms.some(e=>project.constraints.lockedElementIds.includes(e!.id)))return empty('A selected room is locked.');
  const frame:Frame={x:first.x,y:first.y,rotation:first.rotation},originalRect=rect(first,frame),level=first.levelId;
  const floorRooms=project.elements.filter(e=>e.kind==='room'&&e.levelId===level),sameRooms=floorRooms.filter(e=>native(e,generation)&&!e.footprint&&near(angle(e.rotation-frame.rotation),0));
  if(spec.action==='resize-room'&&(!Number.isFinite(spec.targetArea)||spec.targetArea<1||spec.targetArea>300||Math.abs(spec.targetArea-area(originalRect))<=EPS))return empty('Local resize needs a different, exact 1–300 m² net target.');
  if(spec.action==='replace-rooms'&&(!spec.name.trim()||spec.name.length>120||!['bedroom','bathroom','living','kitchen','dining','theater','pool','study','utility','garage','other'].includes(spec.use)))return empty('Enter a valid replacement room name and supported room use.');
  const candidates=spec.action==='replace-rooms'?[rooms[1]!]:sameRooms.filter(e=>e.id!==first.id&&join(originalRect,rect(e,frame))).sort((a,b)=>Number(b.properties.use==='circulation'||String(b.properties.layoutKey).startsWith('@'))-Number(a.properties.use==='circulation'||String(a.properties.layoutKey).startsWith('@'))||a.id.localeCompare(b.id));
  const failures:string[]=[];
  for(const neighbor of candidates){
   const neighborRect=rect(neighbor,frame),shared=join(originalRect,neighborRect);if(!shared){failures.push('The rooms do not share one complete straight partition; an L-shaped or partial-edge merge is unsupported.');continue;}
   try{
    const after=new Map(project.elements.map(e=>[e.id,e])),notes:string[]=[],created:BimElement[]=[],removed=new Set<string>();let serial=0;
    const prefix='idPrefix'in spec?spec.idPrefix:'local-edit';if(!/^[A-Za-z0-9_-]{1,60}$/.test(prefix))throw new Error('Use a valid deterministic local-edit identifier prefix.');
    const newId=()=>{const id=`${prefix}-wall-${++serial}`;if(after.has(id)||created.some(e=>e.id===id))throw new Error('A derived local wall identifier already exists.');return id;};
    const put=(e:BimElement)=>after.set(e.id,e),remove=(id:string)=>{removed.add(id);after.delete(id);};
    const firstKey=String(first.properties.layoutKey),neighborKey=String(neighbor.properties.layoutKey);
    if(!first.properties.layoutKey||!neighbor.properties.layoutKey||firstKey===neighborKey)throw new Error('The affected rooms need distinct native room keys.');
    let firstNext={...originalRect},neighborNext={...neighborRect},shift=0;
    if(spec.action==='resize-room'){
     shift=(spec.targetArea-area(originalRect))/(shared.end-shared.start)*shared.sign;
     if(shared.axis==='x'){if(shared.sign===1){firstNext.x1+=shift;neighborNext.x0+=shift;}else{firstNext.x0+=shift;neighborNext.x1+=shift;}}
     else if(shared.sign===1){firstNext.y1+=shift;neighborNext.y0+=shift;}else{firstNext.y0+=shift;neighborNext.y1+=shift;}
     if(!donorFits(first,firstNext))throw new Error(`${first.name} cannot meet the requested area while retaining its local concept minimum dimensions/area.`);
     if(!donorFits(neighbor,neighborNext))throw new Error(`${neighbor.name} cannot donate this area while retaining the local concept minimum dimensions/area (circulation 1.2 m; ordinary rooms 2.4 m and 9 m²).`);
     put({...withRect(first,firstNext,frame),properties:{...first.properties,requestedArea:spec.targetArea}});
     put({...withRect(neighbor,neighborNext,frame),properties:{...neighbor.properties,requestedArea:area(neighborNext)}});
     notes.push(`${first.name}: ${area(originalRect).toFixed(3)} → ${area(firstNext).toFixed(3)} m² net. ${neighbor.name} ${area(neighborRect)>=area(neighborNext)?'donates':'receives'} ${Math.abs(area(neighborRect)-area(neighborNext)).toFixed(3)} m² and retains ${area(neighborNext).toFixed(3)} m². These are preliminary concept minima, not statutory approval.`);
    }else{
     firstNext={x0:Math.min(originalRect.x0,neighborRect.x0),y0:Math.min(originalRect.y0,neighborRect.y0),x1:Math.max(originalRect.x1,neighborRect.x1),y1:Math.max(originalRect.y1,neighborRect.y1)};
     const properties:BimElement['properties']={...first.properties,use:spec.use,requestedArea:area(firstNext)};delete properties.attachedTo;
     put({...withRect(first,firstNext,frame),name:spec.name.trim(),properties});remove(neighbor.id);
     notes.push(`${first.name} and ${neighbor.name} become ${spec.name.trim()} (${area(firstNext).toFixed(3)} m², including the removed partition strip). The first room ID and outer envelope are retained.`);
    }
    // Split only the shared wall's clear-room span. Residual strips preserve every
    // world-space piece beyond the edit region; perpendicular T-junctions stay put.
    const wallCandidates=project.elements.filter(e=>e.kind==='wall'&&e.levelId===level).map(e=>({e,r:rect(e,frame)})).filter(({r})=>shared.axis==='x'?near((r.x0+r.x1)/2,shared.at)&&near(width(r),shared.gap)&&r.y1>shared.start+EPS&&r.y0<shared.end-EPS:near((r.y0+r.y1)/2,shared.at)&&near(depth(r),shared.gap)&&r.x1>shared.start+EPS&&r.x0<shared.end-EPS);
    const coverage:[number,number][]=[];
    for(const {e:wall,r}of wallCandidates){
     if(!native(wall,generation)||wall.properties.exterior===true)throw new Error('The shared partition includes an exterior, imported, manual or read-only wall.');
     if(['loadBearing','structural','isStructural','loadBearingWall'].some(key=>wall.properties[key]===true||typeof wall.properties[key]==='string'&&['true','yes','1'].includes(String(wall.properties[key]).trim().toLowerCase())))throw new Error(`${wall.name} is explicitly declared structural/load-bearing. A local room edit cannot move, split or remove it; obtain a separately engineered design.`);
     const low=Math.max(shared.start,shared.axis==='x'?r.y0:r.x0),high=Math.min(shared.end,shared.axis==='x'?r.y1:r.x1);coverage.push([low,high]);
     const cut={...r,...(shared.axis==='x'?{y0:low,y1:high}:{x0:low,x1:high})},parts:Rect[]=[];
     if((shared.axis==='x'?r.y0:r.x0)<low-EPS)parts.push({...r,...(shared.axis==='x'?{y1:low}:{x1:low})});
     if((shared.axis==='x'?r.y1:r.x1)>high+EPS)parts.push({...r,...(shared.axis==='x'?{y0:high}:{x0:high})});
     const moved=spec.action==='resize-room'?{...cut,...(shared.axis==='x'?{x0:cut.x0+shift,x1:cut.x1+shift}:{y0:cut.y0+shift,y1:cut.y1+shift})}:null;
     // Retain the original ID for the longest unchanged residual, when present.
     parts.sort((a,b)=>area(b)-area(a));const pieces:{e:BimElement;r:Rect;moved:boolean}[]=[];
     for(const [index,part]of parts.entries()){const next=withRect({...wall,id:index===0?wall.id:newId()},part,frame);put(next);if(index)created.push(next);pieces.push({e:next,r:part,moved:false});}
     if(moved){const next=withRect({...wall,id:parts.length?newId():wall.id},moved,frame);put(next);if(parts.length)created.push(next);pieces.push({e:next,r:cut,moved:true});}
     if(!parts.length&&!moved)remove(wall.id);
     for(const child of project.elements.filter(e=>e.hostId===wall.id)){
      const childRect=rect(child,frame),lo=shared.axis==='x'?childRect.y0:childRect.x0,hi=shared.axis==='x'?childRect.y1:childRect.x1,inCut=lo>=low-EPS&&hi<=high+EPS;
      if(spec.action==='replace-rooms'&&inCut){if(child.kind!=='door')throw new Error('An internal partition window cannot be silently deleted during room replacement.');if([child.properties.accessFrom,child.properties.accessTo].some(key=>typeof key==='string'&&!([firstKey,neighborKey].includes(key))))throw new Error('A partition door refers to a different room; its access relationship must be resolved before removal.');remove(child.id);continue;}
      const piece=pieces.find(piece=>{const a=shared.axis==='x'?piece.r.y0:piece.r.x0,b=shared.axis==='x'?piece.r.y1:piece.r.x1;return lo>=a-EPS&&hi<=b+EPS;});
      if(!piece)throw new Error('The local wall cut would bisect a hosted opening.');
      const next=piece.moved?withRect(child,{...childRect,...(shared.axis==='x'?{x0:childRect.x0+shift,x1:childRect.x1+shift}:{y0:childRect.y0+shift,y1:childRect.y1+shift})},frame):child;
      if(piece.e.id!==child.hostId||piece.moved)put({...next,hostId:piece.e.id});
     }
     if(parts.length)notes.push(`${wall.name} is split locally; unchanged residual geometry is retained and dependent openings are explicitly rehosted.`);
    }
    coverage.sort((a,b)=>a[0]-b[0]);let covered=shared.start;for(const [lo,hi]of coverage){if(lo>covered+EPS)break;covered=Math.max(covered,hi);}if(covered<shared.end-EPS)throw new Error('No continuous native partition spans the entire shared room edge.');
    const affectedKeys=new Set([firstKey,neighborKey]);
    if(spec.action==='replace-rooms'){
     for(const e of [...after.values()].filter(e=>e.levelId===level&&e.properties.conceptGeneration===generation)){
      const properties={...e.properties};let changed=false;
      for(const key of ['accessFrom','accessTo','roomKey'])if(properties[key]===neighborKey){properties[key]=firstKey;changed=true;}
      if(properties.attachedTo===neighborKey||properties.attachedTo===firstKey){if(spec.use==='bedroom')properties.attachedTo=firstKey;else delete properties.attachedTo;changed=true;}
      if(changed){put({...e,properties});if(e.kind==='room'&&e.properties.attachedTo)notes.push(`${e.name} is retained; its obsolete ensuite-to-bedroom tag is ${spec.use==='bedroom'?'transferred to the retained bedroom':'removed because the replacement is not a bedroom'}.`);}
     }
    }
    // Keep hosted doors/windows inside their actual affected room interface. On an
    // unchanged long cross-wall, only a necessary along-wall adjustment is made.
    const byKey=new Map([...after.values()].filter(e=>e.kind==='room'&&e.levelId===level&&e.properties.conceptGeneration===generation).map(e=>[String(e.properties.layoutKey),e]));
    for(const opening of [...after.values()].filter(e=>(e.kind==='door'||e.kind==='window')&&e.levelId===level)){
     if(![opening.properties.roomKey,opening.properties.accessFrom,opening.properties.accessTo].some(key=>typeof key==='string'&&affectedKeys.has(key)))continue;
     const host=after.get(opening.hostId??'');if(!host)throw new Error('A retained opening lost its wall host.');
     const hr=rect(host,frame),vertical=depth(hr)>width(hr),or=rect(opening,frame);let lo=vertical?hr.y0:hr.x0,hi=vertical?hr.y1:hr.x1;
     const keys=opening.kind==='window'?[opening.properties.roomKey]:[opening.properties.accessFrom,opening.properties.accessTo];
     for(const key of keys){const r=typeof key==='string'?byKey.get(key):undefined;if(!r)continue;const rr=rect(r,frame);lo=Math.max(lo,vertical?rr.y0:rr.x0);hi=Math.min(hi,vertical?rr.y1:rr.x1);
      const at=vertical?(hr.x0+hr.x1)/2:(hr.y0+hr.y1)/2,normalLow=vertical?rr.x0:rr.y0,normalHigh=vertical?rr.x1:rr.y1;if(Math.min(Math.abs(at-normalLow),Math.abs(at-normalHigh))>(vertical?width(hr):depth(hr))+.01)throw new Error(`${opening.name} no longer lies on the affected room boundary.`);
     }
     const length=vertical?depth(or):width(or),old=vertical?or.y0:or.x0,margin=.05;
     if(hi-lo<length+2*margin-EPS)throw new Error(`${opening.name} cannot fit its retained room interface after this local edit.`);
     const position=Math.max(lo+margin,Math.min(hi-margin-length,old));
     if(Math.abs(position-old)>EPS){put(withRect(opening,{...or,...(vertical?{y0:position,y1:position+length}:{x0:position,x1:position+length})},frame));notes.push(`${opening.name} shifts ${(Math.abs(position-old)).toFixed(3)} m along its existing host to remain within the affected room interface.`);}
    }
    const affectedRooms=new Set([first.id,neighbor.id]);
    for(const room of floorRooms){if(affectedRooms.has(room.id))continue;if(overlap(firstNext,rect(room,frame))||spec.action==='resize-room'&&overlap(neighborNext,rect(room,frame)))throw new Error(`The local room edit would overlap ${room.name}.`);}
    const candidate={...project,elements:[...after.values()]};
    const changes=project.elements.filter(e=>after.has(e.id)&&JSON.stringify(e)!==JSON.stringify(after.get(e.id))).map(e=>({elementId:e.id,before:structuredClone(e),after:structuredClone(after.get(e.id)!)}));
    const removals=project.elements.filter(e=>removed.has(e.id)).map(e=>({elementId:e.id,before:structuredClone(e),after:null as null}));
    for(const change of changes){const original=project.elements.find(e=>e.id===change.elementId)!;if(!native(original,generation)||locked(project,original,change.after as BimElement))throw new Error(`${original.name} is locked, foreign or read-only and is required by the local geometry change.`);if(original.kind==='wall'&&original.properties.exterior===true&&!geometrySame(rect(original,frame),rect(change.after as BimElement,frame)))throw new Error('An exterior wall would move; local room edits must retain the building envelope.');}
    for(const removal of removals)if(!native(removal.before,generation)||locked(project,removal.before))throw new Error(`${removal.before.name} cannot be removed because it is locked, foreign or read-only.`);
    const changedIds=new Set([...changes.map(c=>c.elementId),...created.map(e=>e.id)]),newErrors=validateModelGeometry(candidate).filter(issue=>issue.severity==='error'&&issue.elementIds.some(id=>changedIds.has(id)));
    if(newErrors.length)throw new Error(newErrors.map(issue=>issue.message).join(' '));
    const physical=candidate.elements.filter(e=>e.levelId===level&&['wall','stair','reference'].includes(e.kind));
    for(const e of physical){const r=rect(e,frame);if(overlap(firstNext,r)||spec.action==='resize-room'&&overlap(neighborNext,r))throw new Error(`The affected room would contain/intersect ${e.name}; the edit cannot move or absorb this construction.`);}
    for(const e of physical.filter(e=>changedIds.has(e.id))){const er=rect(e,frame);for(const other of physical){if(e.id===other.id||Math.min(e.z+e.height,other.z+other.height)-Math.max(e.z,other.z)<=EPS)continue;if(overlap(er,rect(other,frame)))throw new Error(`The local partition would intersect ${other.name}; this junction cannot be changed safely by the bounded edit.`);}}
    notes.push('Modified concept partitions are treated as nonstructural assumptions only when no structural/load-bearing flag is declared; verify their actual construction with a qualified professional.');
    notes.push('No global repacking: other floors, slabs, stairs and the exterior wall envelope remain unchanged. Review structural implications and revalidate dependent service routes before construction.');
    return{changes,creations:created.map(e=>({elementId:e.id,before:null,after:structuredClone(after.get(e.id)!)})),removals,issues:[],notes};
   }catch(error){failures.push(error instanceof Error?error.message:'This local adjacency is unsupported.');}
  }
  return empty(failures[0]??'No full-edge adjacent native room can accommodate this edit without changing unrelated geometry.');
 }catch(error){return empty(error instanceof Error?error.message:'The local room edit is invalid.');}
}
