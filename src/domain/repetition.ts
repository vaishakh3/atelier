import type { BimElement, Project } from './types';
import { validateModelGeometry } from '../model/geometry';

export interface RepetitionRequest { sourceIds:string[]; count:number; offsetX:number; offsetY:number; idPrefix:string }
export interface RepetitionPreview { elements:BimElement[]; sourceIds:string[]; issues:string[] }

/** Detached translation copies. The caller reviews and atomically commits the complete returned set. */
export function previewRepetition(project:Project,request:RepetitionRequest):RepetitionPreview {
  const issues:string[]=[],selected=new Set(request.sourceIds),byId=new Map(project.elements.map(element=>[element.id,element]));
  const invalid=(message:string):RepetitionPreview=>({elements:[],sourceIds:[...selected],issues:[...issues,message]});
  if(!Number.isInteger(request.count)||request.count<1||request.count>100)return invalid('Choose between 1 and 100 copies.');
  if(![request.offsetX,request.offsetY].every(Number.isFinite)||Math.abs(request.offsetX)>1000||Math.abs(request.offsetY)>1000)return invalid('Repetition offsets must be finite metres within ±1000 m.');
  if(Math.hypot(request.offsetX,request.offsetY)<.005)return invalid('Use an offset of at least 0.005 m to avoid coincident copies.');
  if(!/^[A-Za-z0-9_-]{1,60}$/.test(request.idPrefix))return invalid('Use a stable 1–60 character letter, number, dash or underscore ID prefix.');
  if(!selected.size||selected.size>100)return invalid('Select between 1 and 100 source elements.');
  if([...selected].some(id=>!byId.has(id)))return invalid('A selected source element no longer exists. Refresh the selection.');
  // Copy children exactly once, even when a child was explicitly selected with its wall.
  for(const element of project.elements)if(element.hostId&&selected.has(element.hostId)&&byId.get(element.hostId)?.kind==='wall')selected.add(element.id);
  if(selected.size*request.count>100)return invalid('This operation would create more than 100 elements including hosted openings. Reduce copies or selection.');
  const locks=new Set(project.constraints.lockedElementIds),properties=project.constraints.lockedProperties;
  if(properties.includes('*')||properties.includes('geometry')||request.offsetX!==0&&properties.includes('x')||request.offsetY!==0&&properties.includes('y'))return invalid('The required translation is locked by project constraints.');
  const sources=project.elements.filter(element=>selected.has(element.id));
  for(const source of sources){
    if(!source.editable||source.kind==='reference'||locks.has(source.id))return invalid(`${source.name}: locked or read-only elements cannot be repeated.`);
    const type=project.types.find(candidate=>candidate.id===source.typeId);
    if(!type||type.kind!==source.kind)return invalid(`${source.name}: resolve the missing or incompatible component type before repetition.`);
  }
  const elements:BimElement[]=[],ids=new Set(project.elements.map(element=>element.id));
  for(let copy=1;copy<=request.count;copy++){
    const mapping=new Map(sources.map(source=>[source.id,`${request.idPrefix}-${source.id.slice(0,80)}-${copy}`]));
    for(const source of sources){
      const id=mapping.get(source.id)!;
      if(ids.has(id))return invalid('A generated element ID already exists. Use a new preview prefix.');
      ids.add(id);
      const clone=structuredClone(source);delete clone.externalId;
      clone.id=id;clone.name=properties.includes('name')?source.name:`${source.name} (copy ${copy})`;
      clone.x+=request.offsetX*copy;clone.y+=request.offsetY*copy;
      if(clone.hostId&&mapping.has(clone.hostId))clone.hostId=mapping.get(clone.hostId);
      if(!Number.isFinite(clone.x)||!Number.isFinite(clone.y)||Math.abs(clone.x)>1e7||Math.abs(clone.y)>1e7)return invalid('Copied coordinates exceed the supported building range.');
      elements.push(clone);
    }
  }
  const createdIds=new Set(elements.map(element=>element.id));
  const geometry=validateModelGeometry({...project,elements:[...project.elements,...elements]}).filter(issue=>issue.severity==='error'&&issue.elementIds.some(id=>createdIds.has(id)));
  if(geometry.length)return{elements:[],sourceIds:[...selected],issues:[...new Set(geometry.map(issue=>issue.message))]};
  return{elements,sourceIds:sources.map(source=>source.id),issues};
}
