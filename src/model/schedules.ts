import type { BimElement, Project } from '../domain/types';
import { validateModelGeometry } from './geometry';

export interface ModelScheduleBase { elementId:string; externalId:string; name:string; levelId:string; level:string; typeId:string; typeName:string; material:string; classification:string; specification:string; issues:string[] }
export interface RoomScheduleRow extends ModelScheduleBase { number:string; use:string; finish:string; area:number; areaUnit:'m²'; width:number; depth:number }
export interface OpeningScheduleRow extends ModelScheduleBase { mark:string; hostId:string; hostName:string; width:number; height:number; sillHeight:number; fireRating:string; count:1; dimensionUnit:'m' }
export interface ModelSchedules {
  metadata:{projectId:string;projectName:string;version:number;updatedAt:string;displayUnits:Project['units'];geometryUnits:'m'};
  rooms:RoomScheduleRow[]; doors:OpeningScheduleRow[]; windows:OpeningScheduleRow[]; issues:string[];
}
const value=(element:BimElement,key:string)=>element.properties[key]===undefined?'':String(element.properties[key]);
const round=(number:number)=>Math.round(number*1e6)/1e6;

/** Individual rows retain IDs instead of hiding absent specifications in grouped counts. */
export function modelSchedules(project:Project):ModelSchedules {
  const elementById=new Map(project.elements.map(element=>[element.id,element]));
  const typeById=new Map(project.types.map(type=>[type.id,type])),levelById=new Map(project.levels.map(level=>[level.id,level]));
  const geometryIssues=validateModelGeometry(project);
  const allIssues:string[]=[];
  function base(element:BimElement):ModelScheduleBase {
    const type=typeById.get(element.typeId),level=levelById.get(element.levelId);
    const issues=geometryIssues.filter(issue=>issue.elementIds.includes(element.id)).map(issue=>issue.message);
    if(!type)issues.push('Component type missing.');
    if(!level)issues.push('Building level missing.');
    if(!value(element,'classification'))issues.push('Classification missing.');
    if(!value(element,'specification')&&element.kind!=='room')issues.push('Specification missing.');
    if(!element.material&&element.kind!=='room')issues.push('Material missing.');
    return{elementId:element.id,externalId:element.externalId??'',name:element.name,levelId:element.levelId,level:level?.name??'Unknown level',typeId:element.typeId,typeName:type?.name??'Unmapped',material:element.material,classification:value(element,'classification'),specification:value(element,'specification'),issues};
  }
  const rooms:RoomScheduleRow[]=[],doors:OpeningScheduleRow[]=[],windows:OpeningScheduleRow[]=[];
  const ordered=[...project.elements].sort((a,b)=>(levelById.get(a.levelId)?.elevation??0)-(levelById.get(b.levelId)?.elevation??0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  for(const element of ordered){
    if(element.kind==='room'){
      const common=base(element);
      const use=value(element,'use')||value(element,'occupancy'),finish=value(element,'finish');
      if(!use)common.issues.push('Room use/occupancy missing.');
      if(!finish)common.issues.push('Room finish missing.');
      rooms.push({...common,number:value(element,'number')||value(element,'roomNumber'),use,finish,area:round(element.width*element.depth),areaUnit:'m²',width:element.width,depth:element.depth});
    }else if(element.kind==='door'||element.kind==='window'){
      const common=base(element),host=element.hostId?elementById.get(element.hostId):undefined;
      const row:OpeningScheduleRow={...common,mark:value(element,'mark')||element.name,hostId:element.hostId??'',hostName:host?.name??'Missing host',width:element.width,height:element.height,sillHeight:round(element.z-(host?.z??levelById.get(element.levelId)?.elevation??0)),fireRating:value(element,'fireRating'),count:1,dimensionUnit:'m'};
      (element.kind==='door'?doors:windows).push(row);
    }
  }
  for(const row of [...rooms,...doors,...windows])allIssues.push(...row.issues.map(issue=>`${row.name} (${row.elementId}): ${issue}`));
  return{metadata:{projectId:project.id,projectName:project.name,version:project.version,updatedAt:project.updatedAt,displayUnits:project.units,geometryUnits:'m'},rooms,doors,windows,issues:allIssues};
}
