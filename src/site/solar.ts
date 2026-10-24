import type {Project} from '../domain/types';
import {footprint} from '../model/geometry';
import {placedAssetGeometry} from './exchange';
import type {SiteContext,SiteVector} from './types';
export const solarReferences={equations:'https://gml.noaa.gov/grad/solcalc/solareqns.PDF',limitations:'https://gml.noaa.gov/grad/solcalc/calcdetails.html'};
const radians=(n:number)=>n*Math.PI/180,degrees=(n:number)=>n*180/Math.PI,mod=(n:number,m:number)=>(n%m+m)%m;
export interface SunPosition {azimuth:number;elevation:number;declination:number;equationOfTime:number;direction:SiteVector;aboveHorizon:boolean}
/** NOAA fractional-year approximation. Geometric centre of sun; no refraction, weather or irradiance model. */
export function solarPosition(site:SiteContext,date:string,localHour:number):SunPosition{
 if(!Number.isFinite(site.trueNorthAngle)||Math.abs(site.trueNorthAngle)>360)throw new Error('Enter a finite true-north angle between -360 and 360 degrees.');
 if(site.latitude===null||site.longitude===null||!Number.isFinite(site.latitude)||Math.abs(site.latitude)>89||!Number.isFinite(site.longitude)||Math.abs(site.longitude)>180||!Number.isFinite(site.utcOffsetHours)||site.utcOffsetHours< -12||site.utcOffsetHours>14||!Number.isFinite(localHour)||localHour<0||localHour>24)throw new Error('Enter valid latitude, longitude, UTC offset and local civil hour.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Choose a valid Gregorian analysis date.');
 const timestamp=Date.parse(`${date}T00:00:00Z`),instant=new Date(timestamp);if(!Number.isFinite(timestamp)||instant.toISOString().slice(0,10)!==date||instant.getUTCFullYear()<1901||instant.getUTCFullYear()>2099)throw new Error('Solar screening supports valid dates from 1901 to 2099.');
 const year=instant.getUTCFullYear(),days=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000,day=Math.floor((timestamp-Date.UTC(year,0,1))/86400000)+1;
 const gamma=2*Math.PI/days*(day-1+(localHour-12)/24);
 const equationOfTime=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
 const declination=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
 const trueMinutes=mod(localHour*60+equationOfTime+4*site.longitude-60*site.utcOffsetHours,1440),ha=radians(trueMinutes/4-180),latitude=radians(site.latitude);
 const zenith=Math.acos(Math.max(-1,Math.min(1,Math.sin(latitude)*Math.sin(declination)+Math.cos(latitude)*Math.cos(declination)*Math.cos(ha))));
 const elevation=90-degrees(zenith),azimuth=mod(degrees(Math.atan2(Math.sin(ha),Math.cos(ha)*Math.sin(latitude)-Math.tan(declination)*Math.cos(latitude)))+180,360),angle=radians(azimuth-site.trueNorthAngle);
 const direction={x:Math.cos(radians(elevation))*Math.sin(angle),y:Math.cos(radians(elevation))*Math.cos(angle),z:Math.sin(radians(elevation))};
 return{azimuth,elevation,declination:degrees(declination),equationOfTime,direction,aboveHorizon:elevation>0};
}
const subtract=(a:SiteVector,b:SiteVector)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}),cross=(a:SiteVector,b:SiteVector)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x}),dot=(a:SiteVector,b:SiteVector)=>a.x*b.x+a.y*b.y+a.z*b.z;
export function rayTriangle(origin:SiteVector,direction:SiteVector,a:SiteVector,b:SiteVector,c:SiteVector):boolean{
 const edge1=subtract(b,a),edge2=subtract(c,a),h=cross(direction,edge2),determinant=dot(edge1,h);if(Math.abs(determinant)<1e-9)return false;const inverse=1/determinant,s=subtract(origin,a),u=inverse*dot(s,h);if(u< -1e-8||u>1+1e-8)return false;const q=cross(s,edge1),v=inverse*dot(direction,q);return v>=-1e-8&&u+v<=1+1e-8&&inverse*dot(edge2,q)>1e-5;
}
function pointInPolygon(point:SiteVector,polygon:{x:number;y:number}[]){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
export function rayPrism(origin:SiteVector,direction:SiteVector,polygon:{x:number;y:number}[],bottom:number,top:number):boolean{
 if(top<=bottom||polygon.length<3)return false;
 if(origin.z>bottom+1e-5&&origin.z<top-1e-5&&pointInPolygon(origin,polygon))return true;
 if(Math.abs(direction.z)>1e-9)for(const z of [bottom,top]){const t=(z-origin.z)/direction.z;if(t>1e-5&&pointInPolygon({x:origin.x+t*direction.x,y:origin.y+t*direction.y,z},polygon))return true;}
 for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],ex=b.x-a.x,ey=b.y-a.y,den=direction.x*ey-direction.y*ex;if(Math.abs(den)<1e-9)continue;const dx=a.x-origin.x,dy=a.y-origin.y,t=(dx*ey-dy*ex)/den,u=(dx*direction.y-dy*direction.x)/den,z=origin.z+t*direction.z;if(t>1e-5&&u>=0&&u<=1&&z>=bottom-1e-7&&z<=top+1e-7)return true;}
 return false;
}
export interface SunObstruction {id:string;name:string;kind:'model'|'context'|'terrain'}
interface CompiledObstacles {prisms:{id:string;name:string;polygon:{x:number;y:number}[];bottom:number;top:number}[];meshes:{id:string;name:string;kind:'context'|'terrain';vertices:SiteVector[];faces:number[][]}[]}
function compileObstacles(project:Pick<Project,'elements'>,site:SiteContext):CompiledObstacles{
 const prisms=project.elements.filter(e=>['wall','slab','roof','reference'].includes(e.kind)&&e.properties.sunObstruction!==false).map(e=>({id:e.id,name:e.name,polygon:footprint(e),bottom:e.z,top:e.z+e.height}));
 const meshes:CompiledObstacles['meshes']=site.contexts.filter(a=>a.format!=='image'&&a.faces.length).map(asset=>({id:asset.id,name:asset.name,kind:'context',...placedAssetGeometry(asset)}));
 if(site.terrain?.faces.length)meshes.push({id:'terrain',name:site.terrain.source,kind:'terrain',vertices:site.terrain.vertices,faces:site.terrain.faces});return{prisms,meshes};
}
function obstructionFrom(obstacles:CompiledObstacles,origin:SiteVector,direction:SiteVector):SunObstruction|null{
 if(direction.z<=0)return null;
 for(const prism of obstacles.prisms)if(rayPrism(origin,direction,prism.polygon,prism.bottom,prism.top))return{id:prism.id,name:prism.name,kind:'model'};
 for(const mesh of obstacles.meshes)for(const face of mesh.faces)if(rayTriangle(origin,direction,...face.map(i=>mesh.vertices[i])as[SiteVector,SiteVector,SiteVector]))return{id:mesh.id,name:mesh.name,kind:mesh.kind};
 return null;
}
export function directSunObstruction(project:Pick<Project,'elements'>,site:SiteContext,origin:SiteVector,direction:SiteVector):SunObstruction|null{return obstructionFrom(compileObstacles(project,site),origin,direction);}
export interface SunHoursResult {date:string;stepMinutes:number;samples:number;potentialDaylightHours:number;receivers:{point:SiteVector;directSunHours:number;shadedHours:number}[];notes:string[]}
export function analyseSunHours(project:Pick<Project,'elements'>,site:SiteContext,date:string,points:SiteVector[],stepMinutes=30):SunHoursResult{
 if(![15,30,60].includes(stepMinutes)||points.length<1||points.length>100||points.some(p=>![p.x,p.y,p.z].every(Number.isFinite)))throw new Error('Sun-hours supports 1–100 finite receiver points and a 15, 30 or 60 minute interval.');
 if(project.elements.length>3000||site.contexts.reduce((sum,a)=>sum+a.faces.length,site.terrain?.faces.length??0)>10000)throw new Error('This direct-sun screen is bounded to 3,000 model solids and 10,000 context/terrain triangles.');
 const obstacles=compileObstacles(project,site);if(points.length*(1440/stepMinutes)*(obstacles.prisms.length+obstacles.meshes.reduce((sum,m)=>sum+m.faces.length,0))>20000000)throw new Error('This screening exceeds 20 million bounded ray tests. Reduce the receiver grid, use a coarser interval or simplify context meshes.');
 const receivers=points.map(point=>({point,directSunHours:0,shadedHours:0}));let potentialDaylightHours=0,samples=0;
 for(let minute=stepMinutes/2;minute<1440;minute+=stepMinutes){const sun=solarPosition(site,date,minute/60);samples++;if(!sun.aboveHorizon)continue;potentialDaylightHours+=stepMinutes/60;for(const receiver of receivers)if(obstructionFrom(obstacles,receiver.point,sun.direction))receiver.shadedHours+=stepMinutes/60;else receiver.directSunHours+=stepMinutes/60;}
 return{date,stepMinutes,samples,potentialDaylightHours,receivers,notes:['NOAA fractional-year geometric sun position, sampled at interval midpoints in the entered local civil time. Confirm the UTC offset including any daylight saving.','Direct sun at exterior receiver points only: opaque model wall/slab/roof/reference prisms and imported mesh triangles. Openings are conservatively ignored in wall occlusion; doors/windows are not glass/indoor daylight simulations.','DXF linework, raster images, untriangulated survey points, vegetation, weather, surrounding buildings not imported and material transparency do not obstruct the ray model.','Interval sampling can miss short sun/shadow events. No irradiance, daylight factor, wind, thermal comfort or statutory sunlight compliance is calculated. NOAA documentation notes its calculator is no longer maintained; no accuracy certification is claimed.']};
}
/** Top-surface shadow outline on a horizontal receiver plane; excludes terrain relief. */
export function projectedShadow(polygon:{x:number;y:number}[],top:number,plane:number,sun:SunPosition):{x:number;y:number}[]{if(!sun.aboveHorizon||sun.direction.z<.01||top<=plane)return[];const distance=(top-plane)/sun.direction.z;return polygon.map(p=>({x:p.x-sun.direction.x*distance,y:p.y-sun.direction.y*distance}));}
