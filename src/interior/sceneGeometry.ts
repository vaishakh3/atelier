import type {Project} from '../domain/types';
import {localToWorld,modelBounds} from '../model/geometry';
type Vector=[number,number,number];
export interface InteriorCameraFrame {position:Vector;target:Vector}
/** Room.height may be a 2 cm area marker: an eye-level camera must use its real datum. */
export function interiorCameraFrame(project:Project,levelId:string,roomId:string,view:'dollhouse'|'interior'|'exterior'='dollhouse'):InteriorCameraFrame{
 const room=project.elements.find(e=>e.id===roomId&&e.kind==='room'),level=project.levels.find(l=>l.id===levelId),elements=project.elements.filter(e=>view==='exterior'||e.levelId===levelId),bounds=modelBounds(elements);
 if(room&&view==='interior'){
  const polygon=room.footprint??[{x:0,y:0},{x:room.width,y:0},{x:room.width,y:room.depth},{x:0,y:room.depth}],inside=(point:{x:number;y:number})=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
  const candidates=[{x:room.width*.12,y:room.depth*.12},{x:room.width*.88,y:room.depth*.12},{x:room.width*.12,y:room.depth*.88},{x:room.width*.88,y:room.depth*.88},{x:room.width*.5,y:room.depth*.5}];
  for(let y=.15;y<room.depth;y+=.3)for(let x=.15;x<room.width;x+=.3)if(candidates.length<1200)candidates.push({x,y});
  const eyeLocal=candidates.find(inside)??{x:room.width/2,y:room.depth/2},lookLocal={x:room.width*.7,y:room.depth*.74},lookInside=inside(lookLocal)?lookLocal:[...candidates].reverse().find(inside)??eyeLocal;
  const eye=localToWorld(room,eyeLocal.x,eyeLocal.y),look=localToWorld(room,lookInside.x,lookInside.y),declared=Number(room.properties.ceilingHeight),height=Number.isFinite(declared)&&declared>.1?declared:room.height>.1?room.height:2.8;
  return{position:[eye.x,room.z+Math.min(1.55,height*.55),eye.y],target:[look.x,room.z+Math.min(1.1,height*.4),look.y]};
 }
 const center=room&&view!=='exterior'?localToWorld(room,room.width/2,room.depth/2):{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2},target:Vector=[center.x,(room&&view!=='exterior'?room.z:level?.elevation??0)+(view==='exterior'?1:.2),center.y],radius=room&&view!=='exterior'?Math.max(room.width,room.depth):Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,bounds.maxZ);
 return{target,position:[target[0]+radius*.8,target[1]+radius*.95,target[2]+radius*.92]};
}
