import type {Project} from '../domain/types';
import type {ServiceSystem} from './types';
import {inspectServices,pointPosition,servicePlanIsCurrent} from './model';
import {calculateElectricalDemand,calculateServiceEstimate,calculateServiceProgramme} from './calculations';
import {footprint,modelBounds} from '../model/geometry';
import {createPlanDrawing,drawingBounds} from '../model/drawings';
import type {DrawingData,DrawingPrimitive} from '../model/drawings';

export function buildServicesReport(project:Project){
 const plan=project.services;
 return {format:'atelier-services-review',schemaVersion:1,project:{id:project.id,name:project.name,version:project.version,currency:project.currency},
  maturity:'Concept coordination — professional review required',
  limitations:['Routes are conceptual centrelines; they are not installation drawings or actual conductor quantities.','Demand arithmetic does not size cables, protective devices or earthing. Drainage arithmetic does not establish capacity or constructability.','Legal, structural, ventilation, pool and utility approvals remain outside these calculations.'],
  ...(plan?{current:servicePlanIsCurrent(project,plan),plan,coordination:inspectServices(project,plan),estimate:calculateServiceEstimate(project,plan),installation:calculateServiceProgramme(project,plan),electrical:calculateElectricalDemand(plan)}:{current:false,plan:undefined,coordination:[],estimate:undefined,installation:undefined,electrical:undefined,issues:['No services are represented.']})};
}
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const colours:Record<ServiceSystem,string>={'electrical':'#725bd4','cold-water':'#287ea5','drainage':'#ae7045'};
/** Metric vector export of the same persisted concept, with explicit level and review status. */
export function buildServicesSvg(project:Project,levelId:string,systems:ServiceSystem[]=['electrical','cold-water','drainage']):string {
 const level=project.levels.find(l=>l.id===levelId);if(!level)throw new Error('Choose an existing building level.');
 const elements=project.elements.filter(e=>e.levelId===levelId),bounds=modelBounds(elements);
 const x=bounds.minX-1,y=bounds.minY-2,w=Math.max(4,bounds.maxX-bounds.minX+2),h=Math.max(4,bounds.maxY-bounds.minY+4),parts:string[]=[];
 parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="1200" height="900" role="img" aria-label="Services concept plan"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fbfaf7"/><g font-family="Arial,sans-serif">`);
 parts.push(`<text x="${x+.4}" y="${y+.6}" font-size=".25" fill="#393647">${escape(project.name)} · ${escape(level.name)} · v${project.version}</text>`);
 parts.push(`<text x="${x+.4}" y="${y+1}" font-size=".16" fill="#6b6679">Concept coordination · metres · ${project.services&&servicePlanIsCurrent(project,project.services)?'current geometry':'review / reroute required'}</text>`);
 for(const e of elements.filter(e=>['room','wall','door','window'].includes(e.kind))){const points=footprint(e).map(p=>`${p.x},${p.y}`).join(' ');parts.push(`<polygon points="${points}" fill="${e.kind==='wall'?'#bdb8bc':e.kind==='room'?'#f0ece6':'#ffffff'}" stroke="#b9b3c3" stroke-width=".025"/>`);if(e.kind==='room'){const p=footprint(e);const cx=p.reduce((s,v)=>s+v.x,0)/p.length,cy=p.reduce((s,v)=>s+v.y,0)/p.length;parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-size=".17" fill="#655d70">${escape(e.name)}</text>`);}}
 const plan=project.services;
 if(plan){
  for(const route of plan.routes.filter(r=>systems.includes(r.system))){const ends=[plan.points.find(p=>p.id===route.fromId),plan.points.find(p=>p.id===route.toId)];if(!ends.some(p=>p?.levelId===levelId))continue;parts.push(`<polyline points="${route.points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${colours[route.system]}" stroke-width=".045" stroke-dasharray="${route.system==='drainage'?'.14 .08':'none'}"><title>${escape(route.id)} · ${escape(route.system)} · vertical segments projected</title></polyline>`);}
  for(const point of plan.points.filter(p=>p.levelId===levelId&&(['light','switch','socket','equipment','panel'].includes(p.kind)?systems.includes('electrical'):p.kind==='water-inlet'?systems.includes('cold-water'):p.kind==='drain-outlet'?systems.includes('drainage'):systems.some(system=>system==='cold-water'||system==='drainage')))){let p;try{p=pointPosition(project,point);}catch{continue;}parts.push(`<circle cx="${p.x}" cy="${p.y}" r=".09" fill="#fff" stroke="#514166" stroke-width=".035"><title>${escape(point.name)} · ${escape(point.id)}</title></circle>`);}
 }
 parts.push(`<text x="${x+.4}" y="${y+h-.45}" font-size=".14" fill="#6b6679">Electrical: purple · Water: blue · Drainage: brown · Routes include projected risers; elevations and penetrations require review.</text></g></svg>`);
 return parts.join('\n');
}

/** Vector review sheet, using the persisted routes and normal architectural drawing. */
export function createServicesDrawing(project:Project,levelId:string):DrawingData {
 const base=createPlanDrawing(project,levelId,false),plan=project.services;
 const primitives:DrawingPrimitive[]=[...base.primitives];
 if(plan){
  for(const route of plan.routes){if(!plan.points.some(p=>(p.id===route.fromId||p.id===route.toId)&&p.levelId===levelId))continue;primitives.push({kind:'polyline',points:route.points.map(({x,y})=>({x,y})),stroke:colours[route.system],width:.045,dashed:route.system==='drainage',elementId:route.id});}
  for(const point of plan.points.filter(p=>p.levelId===levelId)){let p;try{p=pointPosition(project,point);}catch{continue;}primitives.push({kind:'polygon',points:[{x:p.x-.06,y:p.y-.06},{x:p.x+.06,y:p.y-.06},{x:p.x+.06,y:p.y+.06},{x:p.x-.06,y:p.y+.06}],stroke:'#514166',fill:'#ffffff',width:.03,elementId:point.id});}
 }
 return {...base,title:`${project.levels.find(l=>l.id===levelId)?.name??'Level'} — services concept`,subtitle:'Metres | Purple: electrical; blue: cold water; brown: drainage. Risers projected. Routing/penetrations require review.',primitives,bounds:drawingBounds(primitives),empty:primitives.length===0};
}
