import type {BimElement,ElementKind,LayoutRequest,LayoutRoom,LayoutUse,Project} from './types';
import {layoutSpecSchema} from './schema';
import {footprint,localToWorld,validateModelGeometry} from '../model/geometry';
import type {Point2} from '../model/geometry';

export interface LayoutRoomResult {
 key:string;elementId:string;name:string;use:LayoutUse;requestedArea:number;area:number;
 attachedTo:string|null;accessFrom:string;doorId:string;dimensions:{width:number;depth:number};
}
export interface LayoutPreview {
 elements:BimElement[];issues:string[];assumptions:string[];
 footprint:{x:number;y:number;width:number;depth:number;rotation:number;levelId:string};
 rooms:LayoutRoomResult[];circulation?:{elementId:string;entryDoorId:string;width:number};
}
const WALL=.2,HALL=1.2,HEIGHT=2.9,EPS=1e-6;
// Concept planning assumptions, not statutory minimums or a compliance assessment.
const defaults:Record<LayoutUse,{area:number;width:number;depth:number}>={
 bedroom:{area:14,width:2.7,depth:2.7},bathroom:{area:4.5,width:1.5,depth:1.5},
 living:{area:20,width:3.2,depth:3.2},kitchen:{area:10,width:2.4,depth:2.4},
 dining:{area:12,width:2.7,depth:2.7},theater:{area:16,width:3,depth:3},
 pool:{area:24,width:3.5,depth:4.5},study:{area:9,width:2.4,depth:2.4},
 utility:{area:5,width:1.5,depth:1.5},garage:{area:18,width:2.8,depth:5},other:{area:10,width:2.4,depth:2.4},
};
const dimensionLocks=['geometry','geometry.*','elements','elements.*','position','position.*','dimensions','dimensions.*','x','y','z','width','depth','height','rotation','hostId','levelId'];
const round=(number:number)=>Math.round(number*1000)/1000;
const ceilDecimetre=(number:number)=>Math.ceil((number-EPS)*10)/10;

/** Strict positive polygon intersection; touching boundaries alone do not occupy the footprint. */
function overlaps(a:Point2[],b:Point2[]):boolean {
 for(const polygon of [a,b])for(let index=0;index<polygon.length;index++){
  const p=polygon[index],q=polygon[(index+1)%polygon.length],axis={x:-(q.y-p.y),y:q.x-p.x},length=Math.hypot(axis.x,axis.y);
  if(length<EPS)continue;
  const projection=(points:Point2[])=>points.map(point=>(point.x*axis.x+point.y*axis.y)/length);
  const aa=projection(a),bb=projection(b);
  if(Math.min(Math.max(...aa),Math.max(...bb))-Math.max(Math.min(...aa),Math.min(...bb))<=EPS)return false;
 }
 return true;
}

interface Group {root:LayoutRoom;rooms:LayoutRoom[];depths:number[];height:number;order:number}
interface Side {groups:Group[];height:number;count:number}
interface Arrangement {sides:Side[];stripWidth:number;requiredDepth:number;invalidWidth:boolean}

/** Deterministic rectangular concept layout. Returns only detached creations, never edits or types. */
export function previewLayout(project:Project,request:LayoutRequest):LayoutPreview {
 const initial={x:0,y:0,width:0,depth:0,rotation:0,levelId:request?.levelId??''};
 const result:LayoutPreview={elements:[],issues:[],assumptions:[],footprint:initial,rooms:[]};
 const fail=(message:string):LayoutPreview=>({...result,elements:[],rooms:[],circulation:undefined,issues:[message]});
 if(!request||!/^[A-Za-z0-9_-]{1,60}$/.test(request.idPrefix??''))return fail('Use a stable 1–60 character letter, number, dash or underscore layout ID prefix.');
 const parsed=layoutSpecSchema.safeParse({levelId:request.levelId,footprintId:request.footprintId,width:request.width,depth:request.depth,rooms:request.rooms});
 if(!parsed.success)return fail('Provide 1–16 named rooms with unique stable keys, supported uses, optional 1–300 m² areas, and optional 4–60 m footprint dimensions.');
 const input=parsed.data,level=project.levels.find(candidate=>candidate.id===input.levelId);
 if(!level||!Number.isFinite(level.elevation))return fail('Choose an existing building level with a finite elevation.');
 const globalLocks=project.constraints.lockedProperties;
 if(globalLocks.includes('*')||dimensionLocks.some(property=>globalLocks.includes(property)||globalLocks.includes(`model.${property}`)))return fail('Project geometry or required element dimensions are locked. Unlock them before generating a layout.');
 const keys=new Set(input.rooms.map(room=>room.key));
 if(keys.size!==input.rooms.length)return fail('Room program keys must be unique.');
 if(keys.has('circulation')||keys.has('outside'))return fail('Room keys circulation and outside are reserved for the access network. Choose distinct program keys.');
 const byKey=new Map(input.rooms.map(room=>[room.key,room]));
 for(const room of input.rooms)if(room.attachedTo!==null){
  const parent=byKey.get(room.attachedTo);
  if(room.use!=='bathroom'||!parent||parent.use!=='bedroom'||parent.attachedTo!==null)return fail(`${room.name}: an attached bathroom must reference one primary bedroom in this program.`);
 }
 const roots=input.rooms.filter(room=>room.attachedTo===null);
 if(!roots.length)return fail('Add at least one primary room to the program.');
 for(const bedroom of roots)if(input.rooms.filter(room=>room.attachedTo===bedroom.key).length>1)return fail(`${bedroom.name}: this concept template supports at most one attached bathroom per bedroom.`);
 const slab=input.footprintId?project.elements.find(element=>element.id===input.footprintId):undefined;
 if(input.footprintId&&(!slab||slab.kind!=='slab'||slab.levelId!==level.id))return fail('Select a floor slab on the requested level, or use an empty level without a footprint.');
 if(slab&&project.elements.filter(element=>element.id===slab.id).length!==1)return fail('The selected slab identifier is duplicated. Resolve ambiguous element IDs before generating a layout.');
 if(slab&&(!slab.editable||project.constraints.lockedElementIds.includes(slab.id)||globalLocks.some(lock=>lock===`${slab.id}.*`||dimensionLocks.some(property=>lock===`${slab.id}.${property}`))))return fail('The selected slab is locked or read-only. Choose an editable, unlocked footprint.');
 if(slab&&(![slab.x,slab.y,slab.z,slab.width,slab.depth,slab.height,slab.rotation].every(Number.isFinite)||slab.width<4||slab.depth<4||slab.width>60||slab.depth>60||slab.height<=0||slab.height>1000||Math.abs(slab.rotation)>36000))return fail('The selected slab needs valid dimensions between 4 and 60 m, a positive supported thickness and a rotation within ±36,000 degrees.');
 if(slab&&((input.width!==null&&Math.abs(input.width-slab.width)>.001)||(input.depth!==null&&Math.abs(input.depth-slab.depth)>.001)))return fail('The requested dimensions differ from the selected slab. Its exact footprint is retained; remove conflicting width/depth values.');
 if(!slab&&project.elements.some(element=>element.levelId===level.id))return fail('Without a selected slab, start on an empty level. Existing geometry is never cleared or automatically relocated.');
 const requiredKinds:ElementKind[]=['wall','door','window','room',...(!slab?['slab' as const]:[])];
 const types=new Map(requiredKinds.map(kind=>[kind,project.types.find(type=>type.kind===kind&&type.approved)]));
 const missing=requiredKinds.filter(kind=>!types.get(kind));
 if(missing.length)return fail(`Approve an existing compatible ${missing.join(', ')} component type before generating this layout. Types and rates are never invented.`);
 if([...types.values()].some(type=>project.types.filter(candidate=>candidate.id===type!.id).length!==1))return fail('An approved component type identifier is duplicated. Resolve ambiguous type IDs before generating a layout.');
 if(slab&&(project.types.filter(type=>type.id===slab.typeId).length!==1||!project.types.some(type=>type.id===slab.typeId&&type.kind==='slab'&&type.approved)))return fail('The selected slab needs one unambiguous approved compatible slab type before it can be used as the footprint.');
 const sideCount=roots.length>1?2:1;
 function arrange(width:number):Arrangement {
  const stripWidth=(width-HALL-(sideCount===2?4:3)*WALL)/sideCount;
  const sides:Side[]=Array.from({length:sideCount},()=>({groups:[],height:0,count:0}));
  const groups=roots.map((root,order)=>{
   const rooms=[root,...input.rooms.filter(room=>room.attachedTo===root.key)];
   const depths=rooms.map(room=>Math.max((room.area??defaults[room.use].area)/stripWidth,defaults[room.use].depth));
   return{root,rooms,depths,height:depths.reduce((sum,depth)=>sum+depth,0)+(rooms.length-1)*WALL,order};
  }).sort((a,b)=>b.height-a.height||a.order-b.order);
  for(const group of groups){const side=sides.reduce((best,candidate)=>candidate.height<best.height-EPS?candidate:best,sides[0]);side.height+=group.height+(side.count?WALL:0);side.count+=group.rooms.length;side.groups.push(group);}
  return{sides,stripWidth,requiredDepth:Math.max(...sides.map(side=>side.height))+2*WALL,invalidWidth:input.rooms.some(room=>stripWidth<defaults[room.use].width-EPS)};
 }
 const fixedWidth=slab?.width??input.width,fixedDepth=slab?.depth??input.depth;
 let width=fixedWidth??ceilDecimetre(sideCount*Math.max(4.2,...input.rooms.map(room=>defaults[room.use].width))+HALL+(sideCount===2?4:3)*WALL);
 let arrangement=arrange(width);
 if(fixedWidth===null){
  while((arrangement.invalidWidth||arrangement.requiredDepth>(fixedDepth??60)+EPS)&&width<60){width=round(width+.1);arrangement=arrange(width);}
 }
 const depth=fixedDepth??Math.max(4,ceilDecimetre(arrangement.requiredDepth));
 result.footprint={x:slab?.x??0,y:slab?.y??0,width,depth,rotation:slab?.rotation??0,levelId:level.id};
 if(arrangement.invalidWidth||arrangement.requiredDepth>depth+EPS||width>60||depth>60)return fail(`The room program does not fit this ${round(width)} × ${round(depth)} m footprint with the proposed clear dimensions and circulation. Reduce the program or choose a larger footprint; the slab is not enlarged.`);
 const occupied=project.elements.filter(element=>element.levelId===level.id&&element.id!==slab?.id).find(element=>overlaps(footprint({...element,...result.footprint}),footprint(element)));
 if(occupied)return fail(`The proposed footprint is occupied by ${occupied.name}. Use an empty slab/level; existing geometry is not removed.`);
 result.assumptions.push('Single-storey concept only: 0.20 m walls, 2.90 m wall height and 1.20 m clear circulation are proposed planning assumptions, not code-compliance or structural approval.');
 result.assumptions.push('Room areas are minimum net planning targets, not exact dimensions. The strips share spare space; actual dimensions and areas are listed for review. No unrequested kitchen or other program room is added.');
 result.assumptions.push(slab?'The selected slab, including its exact position, rotation and dimensions, is retained unchanged.':'A 0.20 m concept floor slab is proposed at the level elevation. The shown envelope is proposed, not a site/setback survey.');
 result.assumptions.push('No roof, foundations, structural reinforcement, detailed MEP, services, ventilation, permits or specialist construction costs are generated. Existing approved component types/rates are reused without estimating missing scope.');
 if(input.rooms.some(room=>room.area===null))result.assumptions.push('Unspecified room areas use the listed concept defaults; these remain proposals for architect review.');
 if(input.rooms.some(room=>room.use==='pool'))result.assumptions.push('Pool is a reserved room zone only. No basin, excavation, structural, hydraulic, waterproofing, safety or MEP design is supplied; add an explicit unpriced specialist allowance before estimating this scope.');
 if(input.rooms.some(room=>room.use==='garage'))result.assumptions.push('Garage is a reserved room zone with pedestrian access only. No vehicle opening, ramp or turning/access design is supplied.');
 const frame=result.footprint,base=slab?slab.z+slab.height:level.elevation;
 if(Math.abs(base-level.elevation)>.001)result.assumptions.push(`Wall/opening bases follow the selected slab top at ${round(base)} m, rather than the level datum ${round(level.elevation)} m.`);
 const elements:BimElement[]=[],existingIds=new Set(project.elements.map(element=>element.id));
 const add=(suffix:string,kind:ElementKind,name:string,x:number,y:number,w:number,d:number,h:number,rotation=0,z=base,properties:BimElement['properties']={}):BimElement=>{
  const type=types.get(kind)!,point=localToWorld(frame,x,y);
  const element:BimElement={id:`${request.idPrefix}-${suffix}`,kind,name,levelId:level.id,typeId:type.id,material:type.material,...point,z,width:w,depth:d,height:h,rotation:((frame.rotation+rotation)%360+360)%360,editable:true,properties:{conceptLayout:true,...properties}};
  elements.push(element);return element;
 };
 const opening=(suffix:string,kind:'door'|'window',name:string,host:BimElement,offset:number,w:number,h:number,sill:number,properties:BimElement['properties']={})=>{
  const type=types.get(kind)!,point=localToWorld(host,offset,0);
  const element:BimElement={id:`${request.idPrefix}-${suffix}`,kind,name,levelId:level.id,typeId:type.id,material:type.material,...point,z:base+sill,width:w,depth:host.depth,height:h,rotation:host.rotation,hostId:host.id,editable:true,properties:{conceptLayout:true,...properties}};
  elements.push(element);return element;
 };
 if(!slab)add('floor','slab','Concept floor slab',0,0,width,depth,.2,0,base-.2);
 const front=add('wall-front','wall','Front external wall',0,0,width,WALL,HEIGHT);
 add('wall-back','wall','Rear external wall',0,depth-WALL,width,WALL,HEIGHT);
 const left=add('wall-left','wall','Left external wall',WALL,WALL,depth-2*WALL,WALL,HEIGHT,90);
 const right=add('wall-right','wall','Right external wall',width,WALL,depth-2*WALL,WALL,HEIGHT,90);
 const hallX=sideCount===2?WALL+arrangement.stripWidth+WALL:WALL;
 const hall=add('circulation','room','Entry and circulation',hallX,WALL,HALL,depth-2*WALL,.02,0,base,{use:'circulation',layoutKey:'circulation',classification:'Concept circulation'});
 const entry=opening('door-entry','door','Main entrance',front,hallX+(HALL-.9)/2,.9,2.1,0,{from:'outside',to:'circulation',accessFrom:'outside',accessTo:'circulation'});
 result.circulation={elementId:hall.id,entryDoorId:entry.id,width:HALL};
 for(let sideIndex=0;sideIndex<sideCount;sideIndex++){
  const side=arrangement.sides[sideIndex],isLeft=sideCount===2&&sideIndex===0;
  const stripX=isLeft?WALL:hallX+HALL+WALL;
  const hallWall=add(`wall-hall-${sideIndex}`,'wall',`Circulation partition ${sideIndex+1}`,isLeft?hallX:hallX+HALL+WALL,WALL,depth-2*WALL,WALL,HEIGHT,90);
  const rooms=side.groups.flatMap(group=>group.rooms.map((room,index)=>({room,minimumDepth:group.depths[index]})));
  const spare=depth-2*WALL-side.height,totalClear=rooms.reduce((sum,item)=>sum+item.minimumDepth,0);
  let y=WALL;
  for(let index=0;index<rooms.length;index++){
   const {room,minimumDepth}=rooms[index],roomDepth=minimumDepth+Math.max(0,spare)*minimumDepth/totalClear,target=room.area??defaults[room.use].area;
   const element=add(`room-${room.key}`,'room',room.name,stripX,y,arrangement.stripWidth,roomDepth,.02,0,base,{use:room.use,layoutKey:room.key,requestedArea:target,...(room.attachedTo?{attachedTo:room.attachedTo}:{}),...(room.use==='pool'||room.use==='garage'?{reservedZone:true}:{})});
   let separator:BimElement|undefined;
   if(index>0)separator=add(`wall-partition-${sideIndex}-${index}`,'wall',`Partition before ${room.name}`,stripX,y-WALL,arrangement.stripWidth,WALL,HEIGHT);
   const door=room.attachedTo?opening(`door-room-${room.key}`,'door',`${room.name} from ${byKey.get(room.attachedTo)!.name}`,separator!, (arrangement.stripWidth-.8)/2,.8,2.1,0,{accessFrom:room.attachedTo,accessTo:room.key}):opening(`door-room-${room.key}`,'door',`${room.name} from circulation`,hallWall,y-WALL+(roomDepth-.9)/2,.9,2.1,0,{accessFrom:'circulation',accessTo:room.key});
   const windowWidth=Math.min(room.use==='bathroom'?.6:1.2,roomDepth-.6);
   opening(`window-${room.key}`,'window',`${room.name} external window`,isLeft?left:right,y-WALL+(roomDepth-windowWidth)/2,windowWidth,room.use==='bathroom'?.6:1.2,room.use==='bathroom'?1.6:.9);
   result.rooms.push({key:room.key,elementId:element.id,name:room.name,use:room.use,requestedArea:target,area:round(element.width*element.depth),attachedTo:room.attachedTo,accessFrom:room.attachedTo??'circulation',doorId:door.id,dimensions:{width:round(element.width),depth:round(element.depth)}});
   y+=roomDepth+WALL;
  }
 }
 if(elements.length>200||project.elements.length+elements.length>10_000)return fail('This layout exceeds the 200-created-element or 10,000-project-element limit. Reduce the program.');
 const ids=new Set<string>();
 if(elements.some(element=>existingIds.has(element.id)||ids.has(element.id)?true:(ids.add(element.id),false)))return fail('A generated layout element ID already exists. Use a new preview prefix.');
 if(elements.some(element=>[element.x,element.y,element.z].some(value=>!Number.isFinite(value)||Math.abs(value)>1e7)))return fail('The proposed layout exceeds the supported coordinate range of ±10,000,000 m. Move the footprint closer to the project origin.');
 const geometry=validateModelGeometry({...project,elements:[...project.elements,...elements]}).filter(issue=>issue.severity==='error'&&issue.elementIds.some(id=>ids.has(id)));
 if(geometry.length)return fail(`Generated geometry requires correction: ${[...new Set(geometry.map(issue=>issue.message))].join(' ')}`);
 result.elements=elements;
 return result;
}
