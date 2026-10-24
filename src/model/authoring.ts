import {z} from 'zod';
import type {BimElement,Project,Role} from '../domain/types';
import {footprint,localToWorld,modelBounds,validateModelGeometry} from './geometry';
import type {Point2} from './geometry';
import {polygonArea,polygonProblem} from './polygon';
export interface DesignTemplate {id:string;name:string;kind:'unit'|'floor';elements:BimElement[];createdAt:string}
export interface DesignLibrary {schemaVersion:1;templates:DesignTemplate[]}
export function createDesignLibrarySchema(element:z.ZodType<BimElement>){return z.object({schemaVersion:z.literal(1),templates:z.array(z.object({id:z.string().min(1).max(160),name:z.string().trim().min(1).max(120),kind:z.enum(['unit','floor']),elements:z.array(element).min(1).max(500),createdAt:z.string().max(60)}).strict()).max(12)}).strict().superRefine((library,context)=>{if(new Set(library.templates.map(template=>template.id)).size!==library.templates.length)context.addIssue({code:'custom',message:'Template IDs must be unique.'});for(const template of library.templates){const ids=new Set(template.elements.map(element=>element.id));if(ids.size!==template.elements.length||template.elements.some(element=>element.hostId&&!ids.has(element.hostId)))context.addIssue({code:'custom',message:'Template element IDs and hosted references must be complete and unique.'});}});}
const id=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;
const copy=<T,>(value:T):T=>structuredClone(value);
function author(project:Project,role:Role,ids:string[]=[],keys:string[]=[]){
 if(role!=='admin'&&role!=='editor')throw new Error('Architect or administrator access is required to edit the model.');
 if(ids.some(value=>project.constraints.lockedElementIds.includes(value)))throw new Error('An affected element is locked. Unlock it before changing this model.');
 const guarded=keys.includes('elements')?[...keys,'geometry','position','dimensions']:keys;
 if(project.constraints.lockedProperties.some(lock=>lock==='*'||guarded.some(key=>lock===key||lock===`${key}.*`||ids.some(id=>[`${id}.*`,`${id}.${key}`,`elements.${id}.*`,`elements.${id}.${key}`,`model.elements.${id}.*`,`model.elements.${id}.${key}`].includes(lock)))))throw new Error('A property affected by this operation is locked.');
}
function checked(before:Project,after:Project):Project {
 if(after.elements.length>10000||after.levels.length>100)throw new Error('This operation exceeds the supported project size.');
 const old=new Set(validateModelGeometry(before).filter(issue=>issue.severity==='error').map(issue=>JSON.stringify(issue))),errors=validateModelGeometry(after).filter(issue=>issue.severity==='error'&&!old.has(JSON.stringify(issue)));
 if(errors.length)throw new Error(errors.slice(0,3).map(issue=>issue.message).join(' '));
 if(after.elements.some(element=>![element.x,element.y,element.z,element.width,element.depth,element.height,element.rotation].every(Number.isFinite)||Math.max(Math.abs(element.x),Math.abs(element.y),Math.abs(element.z),element.width,element.depth,element.height)>100000||Math.min(element.width,element.depth,element.height)<=0))throw new Error('The resulting model exceeds finite positive dimension limits.');
 return after;
}
export interface PolygonCreation {name:string;kind:'reference'|'slab'|'roof'|'room';points:Point2[];levelId:string;height:number;typeId?:string}
export function createPolygonElement(project:Project,input:PolygonCreation,role:Role):Project {
 author(project,role,[],['elements','footprint']);const problem=polygonProblem(input.points);if(problem)throw new Error(problem);
 const level=project.levels.find(level=>level.id===input.levelId);if(!level)throw new Error('Choose a current building level.');
 if(!input.name.trim()||input.name.length>120||!Number.isFinite(input.height)||input.height<.01||input.height>1000)throw new Error('Enter a name and an extrusion height between 0.01 and 1000 m.');
 const x=Math.min(...input.points.map(point=>point.x)),y=Math.min(...input.points.map(point=>point.y)),width=Math.max(...input.points.map(point=>point.x))-x,depth=Math.max(...input.points.map(point=>point.y))-y;
 const type=project.types.find(type=>type.id===input.typeId&&type.kind===input.kind)??project.types.find(type=>type.kind===input.kind);
 const element:BimElement={id:id('polygon'),kind:input.kind,name:input.name.trim(),levelId:level.id,typeId:type?.id??'',material:type?.material??'Unspecified',x,y,z:level.elevation,width,depth,height:input.height,rotation:0,editable:true,properties:input.kind==='reference'?{conceptMass:true,measurementScope:'Concept mass; excluded from construction costing'}:{},footprint:input.points.map(point=>({x:point.x-x,y:point.y-y}))};
 return checked(project,{...project,elements:[...project.elements,element]});
}
export interface ModelTransform {dx:number;dy:number;dz:number;rotation:number;scale:number;pivot?:Point2}
export function transformElements(project:Project,selectedIds:string[],change:ModelTransform,role:Role):Project {
 if(!selectedIds.length)throw new Error('Select model elements first.');
 if(![change.dx,change.dy,change.dz,change.rotation,change.scale].every(Number.isFinite)||change.scale<.01||change.scale>100)throw new Error('Enter finite offsets/rotation and a scale between 0.01 and 100.');
 const chosen=new Set(selectedIds);for(const element of project.elements)if(element.hostId&&chosen.has(element.hostId))chosen.add(element.id);
 const source=project.elements.filter(element=>chosen.has(element.id));if(source.length!==chosen.size)throw new Error('The selection contains an unavailable element.');
 if(source.some(element=>!element.editable))throw new Error('Reference-only imported geometry cannot be transformed as architectural elements. Adjust its site placement instead.');
 author(project,role,[...chosen],['elements','x','y','z','width','depth','height','rotation','footprint']);
 const bounds=modelBounds(source),pivot=change.pivot??{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2},baseZ=Math.min(...source.map(element=>element.z)),angle=change.rotation*Math.PI/180;
 if(![pivot.x,pivot.y].every(Number.isFinite))throw new Error('Enter a finite pivot.');
 const elements=project.elements.map(element=>{if(!chosen.has(element.id))return element;const dx=(element.x-pivot.x)*change.scale,dy=(element.y-pivot.y)*change.scale;return{...element,x:pivot.x+dx*Math.cos(angle)-dy*Math.sin(angle)+change.dx,y:pivot.y+dx*Math.sin(angle)+dy*Math.cos(angle)+change.dy,z:baseZ+(element.z-baseZ)*change.scale+change.dz,width:element.width*change.scale,depth:element.depth*change.scale,height:element.height*change.scale,rotation:element.rotation+change.rotation,...(element.footprint?{footprint:element.footprint.map(point=>({x:point.x*change.scale,y:point.y*change.scale}))}:{})};});
 return checked(project,{...project,elements});
}
export function duplicateFloors(project:Project,sourceLevelId:string,count:number,floorHeight:number,role:Role):Project {
 const sourceLevel=project.levels.find(level=>level.id===sourceLevelId);if(!sourceLevel)throw new Error('Choose a current source level.');
 if(!Number.isInteger(count)||count<1||count>12||!Number.isFinite(floorHeight)||floorHeight<2.4||floorHeight>8)throw new Error('Create 1–12 copies at a floor-to-floor height of 2.4–8 m.');
 const source=project.elements.filter(element=>element.levelId===sourceLevelId&&element.kind!=='stair');if(!source.length)throw new Error('The source floor has no copyable elements.');
 author(project,role,source.map(element=>element.id),['elements','levels']);
 const levels=[...project.levels],elements=[...project.elements],top=Math.max(...levels.map(level=>level.elevation));
 for(let i=1;i<=count;i++){const level={id:id('level'),name:`${sourceLevel.name} · copy ${i}`,elevation:top+i*floorHeight};if(levels.some(existing=>Math.abs(existing.elevation-level.elevation)<.01))throw new Error('A target floor already occupies the requested elevation.');levels.push(level);const ids=new Map(source.map(element=>[element.id,id(element.kind)]));for(const original of source){if(original.hostId&&!ids.has(original.hostId))throw new Error('The copied floor contains an opening whose wall is outside the floor.');elements.push({...copy(original),id:ids.get(original.id)!,externalId:undefined,levelId:level.id,z:original.z+level.elevation-sourceLevel.elevation,...(original.hostId?{hostId:ids.get(original.hostId)}:{})});}}
 return checked(project,{...project,levels,elements});
}
export function saveDesignTemplate(project:Project,name:string,kind:'unit'|'floor',selectedIds:string[],levelId:string,role:Role):Project {
 author(project,role,[],['designLibrary']);if(!name.trim()||name.length>120)throw new Error('Enter a template name of 1–120 characters.');
 const chosen=new Set(kind==='floor'?project.elements.filter(element=>element.levelId===levelId&&element.kind!=='stair').map(element=>element.id):selectedIds);
 if(kind==='unit')for(const selected of [...chosen]){const element=project.elements.find(element=>element.id===selected);if(element?.hostId)chosen.add(element.hostId);}for(const element of project.elements)if(element.hostId&&chosen.has(element.hostId))chosen.add(element.id);
 const elements=project.elements.filter(element=>chosen.has(element.id));if(!elements.length||elements.length>500)throw new Error('A reusable template needs 1–500 selected elements.');
 if(new Set(elements.map(element=>element.levelId)).size!==1)throw new Error('Save a unit template from a single building floor.');
 const library=project.designLibrary??{schemaVersion:1 as const,templates:[]};if(library.templates.length>=12)throw new Error('The library supports 12 templates. Remove one before saving another.');
 const bounds=modelBounds(elements),z=kind==='floor'?project.levels.find(level=>level.id===levelId)!.elevation:Math.min(...elements.map(element=>element.z));
 const template:DesignTemplate={id:id('template'),name:name.trim(),kind,createdAt:new Date().toISOString(),elements:elements.map(element=>({...copy(element),x:element.x-bounds.minX,y:element.y-bounds.minY,z:element.z-z,levelId:'template'}))};
 return {...project,designLibrary:{...library,templates:[...library.templates,template]}};
}
export function placeDesignTemplate(project:Project,templateId:string,levelId:string,x:number,y:number,role:Role):Project {
 author(project,role,[],['elements']);const template=project.designLibrary?.templates.find(template=>template.id===templateId),level=project.levels.find(level=>level.id===levelId);
 if(!template||!level)throw new Error('Choose a current template and destination floor.');if(![x,y].every(Number.isFinite))throw new Error('Enter finite placement coordinates.');
 if(template.elements.some(element=>element.kind!=='reference'&&!project.types.some(type=>type.id===element.typeId&&type.kind===element.kind)))throw new Error('A template component type has been removed. Restore it or save a new template.');
 const ids=new Map(template.elements.map(element=>[element.id,id(element.kind)]));const added=template.elements.map(element=>({...copy(element),id:ids.get(element.id)!,externalId:undefined,x:element.x+x,y:element.y+y,z:element.z+level.elevation,levelId:level.id,...(element.hostId?{hostId:ids.get(element.hostId)}:{})}));
 if(added.some(element=>element.kind==='window'||element.kind==='door'? !element.hostId:false))throw new Error('The template is missing an opening host.');
 return checked(project,{...project,elements:[...project.elements,...added]});
}
export interface FacadePattern {kind:'window'|'door';count:number;width:number;height:number;sill:number;replaceExisting:boolean}
export function repeatFacadeOpenings(project:Project,wallIds:string[],pattern:FacadePattern,role:Role):Project {
 const walls=project.elements.filter(element=>wallIds.includes(element.id)&&element.kind==='wall');if(!walls.length)throw new Error('Select one or more wall elements.');
 if(!Number.isInteger(pattern.count)||pattern.count<1||pattern.count>40||![pattern.width,pattern.height,pattern.sill].every(Number.isFinite)||pattern.width<=0||pattern.height<=0||pattern.sill<0)throw new Error('Enter 1–40 openings with positive width/height and a non-negative sill.');
 const old=project.elements.filter(element=>element.hostId&&walls.some(wall=>wall.id===element.hostId));if(pattern.replaceExisting&&old.some(element=>!element.editable))throw new Error('A hosted opening is read-only and cannot be replaced.');author(project,role,[...walls.map(wall=>wall.id),...(pattern.replaceExisting?old.map(element=>element.id):[])],['elements','hostId','width','height','x','y','z']);
 if(walls.some(wall=>!wall.editable))throw new Error('Only editable walls support hosted facade patterns.');
 const type=project.types.find(type=>type.kind===pattern.kind);if(!type)throw new Error('Create a matching opening type before adding this pattern.');
 const added:BimElement[]=[];for(const wall of walls){const gap=(wall.width-pattern.count*pattern.width)/(pattern.count+1);if(gap<.1||pattern.sill+pattern.height>wall.height)throw new Error(`${wall.name}: the pattern needs at least 0.1 m edge/spacing clearance and must fit vertically.`);for(let i=0;i<pattern.count;i++){const position=localToWorld(wall,gap+i*(pattern.width+gap),0);added.push({id:id(pattern.kind),kind:pattern.kind,name:`${wall.name} · ${pattern.kind} ${i+1}`,levelId:wall.levelId,typeId:type.id,material:type.material,...position,z:wall.z+pattern.sill,width:pattern.width,depth:wall.depth,height:pattern.height,rotation:wall.rotation,hostId:wall.id,editable:true,properties:{facadePattern:true}});}}
 const removed=new Set(pattern.replaceExisting?old.map(element=>element.id):[]);return checked(project,{...project,elements:[...project.elements.filter(element=>!removed.has(element.id)),...added]});
}
export function designMetrics(project:Project){return{roomArea:project.elements.filter(element=>element.kind==='room').reduce((sum,element)=>sum+polygonArea(footprint(element)),0),floorArea:project.elements.filter(element=>element.kind==='slab').reduce((sum,element)=>sum+polygonArea(footprint(element)),0),conceptVolume:project.elements.filter(element=>element.kind==='reference'&&element.properties.conceptMass===true).reduce((sum,element)=>sum+polygonArea(footprint(element))*element.height,0)};}

export function removeDesignTemplate(project:Project,templateId:string,role:Role):Project {author(project,role,[],['designLibrary']);if(!project.designLibrary?.templates.some(template=>template.id===templateId))throw new Error('Choose a current template.');return {...project,designLibrary:{...project.designLibrary,templates:project.designLibrary.templates.filter(template=>template.id!==templateId)}};}
