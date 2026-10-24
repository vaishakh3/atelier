import type {BimElement,Project} from '../domain/types';
import type {CompassSector,PlanningContext,PlanningMetric} from '../domain/planning';
import {planningMetricLabels,planningMetricUnits} from '../domain/planning';
import {planningContextSchema} from '../domain/planningSchema';
import {keralaSources} from '../domain/keralaRules';
import {footprint,localToWorld,worldToLocal} from '../model/geometry';

export interface PlanningCheck {id:string;label:string;status:'within-entered-limit'|'outside-entered-limit'|'not-evaluated';actual:number|null;limit:number|null;unit:string;message:string;clause:string;elementIds:string[]}
export interface VaastuCheck {id:string;label:string;status:'matches-preference'|'conflicts-with-preference'|'not-evaluated';sector:CompassSector|null;preferred:CompassSector[];message:string;elementIds:string[]}
export interface PlanningAssessment {
 engineVersion:'planning-checks-v1';projectId:string;projectVersion:number;asOf:string;
 jurisdiction:{country:string;region:string;authority:string};legalStatus:'partial-review'|'not-configured';
 source:PlanningContext['ruleSource']|null;sourceIssues:string[];checks:PlanningCheck[];vaastu:VaastuCheck[];
 coverageGaps:string[];measurementNotes:string[];disclaimer:string;
}
const round=(value:number)=>Math.round(value*1000)/1000;
const same=(a:string,b:string)=>a.trim().toLocaleLowerCase()===b.trim().toLocaleLowerCase();
const allMetrics:PlanningMetric[]=['front-setback','rear-setback','left-setback','right-setback','coverage','floor-area-ratio','height','storeys'];
const floorKinds=new Set(['slab','wall','room']);
const gaps=[
 'Local land use, zoning, master-plan and road-widening restrictions require authority review.',
 'Statutory floor-area inclusions/exemptions, basement/terrace treatment and plot deductions are not calculated.',
 'Fire/egress, accessibility, parking, structural design, drainage, services and pool safety are not certified.',
 'Special overlays, coastal/environmental restrictions, easements, adjoining rights and permits require independent checks.',
];
interface Rect {left:number;right:number;bottom:number;top:number}
/** Exact union of orthogonal rectangular slab pieces, including actual stair voids. */
function unionArea(rects:Rect[]):number|null{
 if(rects.length>1000)return null;
 const xs=[...new Set(rects.flatMap(r=>[r.left,r.right]))].sort((a,b)=>a-b);let total=0;
 for(let i=1;i<xs.length;i++){
  const x=(xs[i-1]+xs[i])/2,ys=rects.filter(r=>r.left<x&&r.right>x).map(r=>[r.bottom,r.top]).sort((a,b)=>a[0]-b[0]);
  let length=0,start=NaN,end=NaN;
  for(const [low,high]of ys){if(!Number.isFinite(start)){start=low;end=high;}else if(low>end){length+=end-start;start=low;end=high;}else end=Math.max(end,high);}
  if(Number.isFinite(start))length+=end-start;total+=(xs[i]-xs[i-1])*length;
 }return Number.isFinite(total)?total:null;
}
function slabAreas(project:Project,plot:NonNullable<PlanningContext['plot']>):{ground:number;total:number}|null{
 const representedFloors=new Set(project.elements.filter(element=>floorKinds.has(element.kind)).map(element=>element.levelId));
 const slabFloors=new Set(project.elements.filter(element=>element.kind==='slab').map(element=>element.levelId));
 // A known floor without its slab is missing area, not a zero-area storey.
 if([...representedFloors].some(id=>!slabFloors.has(id)||!project.levels.some(level=>level.id===id)))return null;
 const floors=project.levels.filter(level=>project.elements.some(e=>e.kind==='slab'&&e.levelId===level.id)).sort((a,b)=>a.elevation-b.elevation);
 if(!floors.length)return null;let total=0,ground=0;
 for(let i=0;i<floors.length;i++){
  const rects:Rect[]=[];
  for(const slab of project.elements.filter(e=>e.kind==='slab'&&e.levelId===floors[i].id)){
   if(slab.footprint)return null; // Rectangular slab-union statutory proxy does not approximate polygon floors.
   const angle=((slab.rotation-plot.rotation)%90+90)%90;if(Math.min(angle,90-angle)>1e-5)return null;
   const pts=footprint(slab).map(p=>worldToLocal(plot,p));rects.push({left:Math.min(...pts.map(p=>p.x)),right:Math.max(...pts.map(p=>p.x)),bottom:Math.min(...pts.map(p=>p.y)),top:Math.max(...pts.map(p=>p.y))});
  }
  const area=unionArea(rects);if(area===null)return null;total+=area;if(i===0)ground=area;
 }return{ground,total};
}
function geometryMeasurements(project:Project,planning:PlanningContext):Partial<Record<PlanningMetric,number>>{
 const physical=project.elements.filter(e=>!['room','reference','door','window'].includes(e.kind));
 if(!physical.length||physical.some(e=>!project.levels.some(level=>level.id===e.levelId)||![e.x,e.y,e.z,e.width,e.depth,e.height,e.rotation].every(Number.isFinite)||Math.min(e.width,e.depth,e.height)<=0||[e.x,e.y,e.z,e.width,e.depth,e.height].some(n=>Math.abs(n)>1e7)))return{};
 // Approximate imported reference bounds cannot establish physical envelope limits.
 if(project.elements.some(e=>e.kind==='reference'))return{};
 const floorCount=new Set(project.elements.filter(e=>floorKinds.has(e.kind)).map(e=>e.levelId)).size;
 const values:Partial<Record<PlanningMetric,number>>=floorCount?{storeys:floorCount}:{};
 if(planning.groundElevation!==null)values.height=Math.max(...physical.map(e=>e.z+e.height))-planning.groundElevation;
 if(!planning.plot)return values;
 const plot=planning.plot,points=physical.flatMap(footprint).map(p=>worldToLocal(plot,p)),bound={south:Math.min(...points.map(p=>p.y)),north:plot.depth-Math.max(...points.map(p=>p.y)),west:Math.min(...points.map(p=>p.x)),east:plot.width-Math.max(...points.map(p=>p.x))};
 const facing={south:['south','north','west','east'],north:['north','south','east','west'],west:['west','east','north','south'],east:['east','west','south','north']}as const;
 const [front,rear,left,right]=facing[planning.frontBoundary];
 values['front-setback']=bound[front];values['rear-setback']=bound[rear];values['left-setback']=bound[left];values['right-setback']=bound[right];
 const areas=slabAreas(project,plot);if(areas){values.coverage=areas.ground/(plot.width*plot.depth)*100;values['floor-area-ratio']=areas.total/(plot.width*plot.depth);}
 return values;
}
function sourceProblems(planning:PlanningContext,asOf:string):string[]{
 const source=planning.ruleSource,issues:string[]=[];
 if(source.amendmentsChecked!==true)issues.push('Check later amendments and local planning provisions before confirming this source.');
 if(!planning.country.trim()||!planning.region.trim()||!planning.authority.trim())issues.push('Set the country, state/region and local authority; free-text project location does not select laws.');
 if(planning.authorityType==='unconfirmed'||planning.authorityType!==source.authorityType)issues.push('Confirm the local-body type; municipality/corporation and panchayat rules must not be interchanged.');
if(!source.title.trim()||!source.version.trim()||!source.url.trim()||!source.applicability.trim()||!source.confirmedBy.trim())issues.push('A project-team reviewer must enter the source, rule version, applicability and their name.');
 if(!same(planning.country,source.country)||!same(planning.region,source.region)||!same(planning.authority,source.authority))issues.push('Rule-source jurisdiction does not exactly match this site.');
 if(!source.effectiveFrom||source.effectiveFrom>asOf)issues.push('Source effective date is missing or later than the review date.');
 if(!source.reviewedOn||source.reviewedOn>asOf)issues.push('Source review date is missing or in the future.');
 if(source.reviewedOn&&Date.parse(asOf)-Date.parse(source.reviewedOn)>365*86400000)issues.push('Atelier requires source revalidation after 365 days. Check subsequent amendments before relying on these limits.');
 return issues;
}
function worksheetProblems(project:Project,planning:PlanningContext,anticipatedHeight?:number):string[]{
 if(planning.ruleSource.worksheet!=='kerala-a1-2025')return[];
 const issues:string[]=[],height=anticipatedHeight??geometryMeasurements(project,planning).height;
 const expected=planning.authorityType==='panchayat'?keralaSources.panchayat:keralaSources.municipal;
 if(planning.ruleSource.title!==expected.title||planning.ruleSource.url!==expected.url||planning.ruleSource.version!==expected.version)issues.push('The dated Kerala source does not match the selected municipal/panchayat branch. Reload its matching worksheet or explicitly configure a new manually reviewed source.');
 if(!same(planning.country,'India')||!same(planning.region,'Kerala'))issues.push('The Kerala worksheet cannot be applied to another state or country.');
 if(height===undefined||height>10)issues.push('The dated Kerala yard worksheet is limited to confirmed model height at most 10 m. This is an applicability threshold, not a universal legal height limit.');
 if(planning.authorityType==='panchayat'&&(!['I','II'].includes(planning.panchayatCategory??'')||planning.panchayatCategory!==planning.ruleSource.panchayatCategory))issues.push('Confirm the notified panchayat category and reload its matching area limits.');
 return issues;
}
/** Hard plot bounds and only explicitly sourced, team-confirmed yard limits. Never infer local law. */
export function reviewedSiteEnvelope(project:Project,asOf=new Date().toISOString().slice(0,10),anticipatedHeight?:number):{plot:NonNullable<PlanningContext['plot']>;west:number;east:number;south:number;north:number;sourceReviewed:boolean}|null{
 const parsed=planningContextSchema.safeParse(project.planning);if(!parsed.success||!parsed.data.plot)return null;
 const planning=parsed.data as PlanningContext,reviewed=sourceProblems(planning,asOf).length===0&&worksheetProblems(project,planning,anticipatedHeight).length===0;
 const result={plot:planning.plot!,west:0,east:0,south:0,north:0,sourceReviewed:reviewed};
 if(reviewed){
  const facing={south:['south','north','west','east'],north:['north','south','east','west'],west:['west','east','north','south'],east:['east','west','south','north']}as const;
  const sides=facing[planning.frontBoundary];
  for(const [index,metric]of (['front-setback','rear-setback','left-setback','right-setback']as const).entries()){
   const rule=planning.rules.find(r=>r.metric===metric);if(rule?.clause.trim())result[sides[index]]=rule.limit;
  }
 }return result;
}
function targetElements(project:Project,target:string):BimElement[]{
 if(target==='stair')return project.elements.filter(e=>e.kind==='stair');
 if(target==='entrance')return project.elements.filter(e=>e.kind==='door'&&(e.properties.accessFrom==='outside'||e.properties.entrance===true));
 return project.elements.filter(e=>e.kind==='room'&&e.properties.use===target);
}
function sectorOf(e:BimElement,planning:PlanningContext):CompassSector|null{
 if(!planning.plot||planning.northAngle===null)return null;
 const plot=planning.plot,point=localToWorld(e,e.width/2,e.depth/2),local=worldToLocal(plot,point);
 if(local.x<0||local.y<0||local.x>plot.width||local.y>plot.depth)return null;
 if(Math.abs(local.x-plot.width/2)<plot.width/6&&Math.abs(local.y-plot.depth/2)<plot.depth/6)return'centre';
 const centre=localToWorld(plot,plot.width/2,plot.depth/2),bearing=Math.atan2(point.x-centre.x,point.y-centre.y)*180/Math.PI+planning.northAngle,angle=((bearing%360)+360)%360;
 return(['N','NE','E','SE','S','SW','W','NW']as CompassSector[])[Math.floor((angle+22.5)%360/45)]??null;
}
export function assessPlanning(project:Project,asOf=new Date().toISOString().slice(0,10)):PlanningAssessment{
 const parsed=planningContextSchema.safeParse(project.planning),planning=parsed.success?parsed.data as PlanningContext:null;
 const result:PlanningAssessment={engineVersion:'planning-checks-v1',projectId:project.id,projectVersion:project.version,asOf,jurisdiction:{country:planning?.country??'',region:planning?.region??'',authority:planning?.authority??''},legalStatus:planning?.rules.length?'partial-review':'not-configured',source:planning?.ruleSource??null,sourceIssues:[],checks:[],vaastu:[],coverageGaps:[...gaps],measurementNotes:[
  'Setbacks measure the full model envelope, including roofs and stairs, in the entered rectangular plot frame. Front/left/right are viewed from the road into the plot.',
  'Coverage = lowest modelled slab-level union / full entered plot area. Floor area ratio = sum of slab unions / plot area. These geometric proxies omit statutory inclusions and exemptions.',
  'Height is maximum physical model Z minus the explicitly entered survey ground elevation. Storeys count represented slab/wall/room floor levels, excluding roof-only levels; statutory storey definitions may differ.',
  'Slab unions support pieces parallel/perpendicular to the plot. Area comparisons remain unevaluated if any represented floor lacks slab geometry. Other unsupported rotations, references or missing model levels remain unevaluated.',
 ],disclaimer:'Preliminary checks against project-team-entered limits only. This report is not legal compliance certification, a permit or architectural/engineering sign-off. Vaastu results reflect optional user-selected preferences, with no statutory or scientific certification.'};
 if(!planning)result.sourceIssues.push(project.planning?'Planning inputs are invalid. No rules were evaluated.':'Site jurisdiction and locally reviewed rules have not been configured.');
 else {
  result.sourceIssues=[...sourceProblems(planning,asOf),...worksheetProblems(project,planning)];
  if(planning.ruleSource.worksheet==='kerala-a1-2025'){
   result.coverageGaps.unshift('Kerala worksheet is dated 29 October 2025. Subsequent amendments, Rule 23 road/building-line requirements, average/minimum yard distinctions and local plans need explicit professional review.');
  }
 }
 const measured=planning?geometryMeasurements(project,planning):{};
 for(const metric of allMetrics){
  const rule=planning?.rules.find(r=>r.metric===metric),actual=measured[metric],sourceReady=result.sourceIssues.length===0&&!!rule?.clause.trim();
  let message=!rule?'No locally applicable limit has been entered.':!sourceReady?'Confirm the applicable source, amendments and clause before comparing this limit.':actual===undefined?'Required site/ground/geometry inputs are missing or unsupported.':'Measured geometry compared with the entered limit; statutory interpretation remains a professional responsibility.';
  const minimum=metric.endsWith('setback'),within=actual!==undefined&&rule&&(minimum?actual+1e-6>=rule.limit:actual-1e-6<=rule.limit);
  const status=!rule||!sourceReady||actual===undefined?'not-evaluated':within?'within-entered-limit':'outside-entered-limit';
  if(status==='outside-entered-limit')message='The model exceeds the entered maximum or falls short of the entered minimum. Revise the model or have the applicable rule reviewed.';
  result.checks.push({id:metric,label:planningMetricLabels[metric],status,actual:actual===undefined?null:round(actual),limit:rule?.limit??null,unit:planningMetricUnits[metric],message,clause:rule?.clause??'',elementIds:status==='outside-entered-limit'?project.elements.filter(e=>!['room','reference','door','window'].includes(e.kind)).map(e=>e.id):[]});
 }
 if(planning?.vaastu.enabled){
  if(!planning.vaastu.preferences.length)result.vaastu.push({id:'unconfigured',label:'Vaastu preferences',status:'not-evaluated',sector:null,preferred:[],message:'Choose directional preferences with the client or Vaastu consultant. No universal profile is assumed.',elementIds:[]});
  for(const preference of planning.vaastu.preferences){
   const elements=targetElements(project,preference.target);
   if(!elements.length)result.vaastu.push({id:preference.id,label:preference.target,status:'not-evaluated',sector:null,preferred:preference.sectors,message:'No matching tagged room/entrance/stair is present. Assign the room use or entrance property explicitly.',elementIds:[]});
   for(const element of elements){const sector=sectorOf(element,planning),matches=sector!==null&&(preference.mode==='prefer'?preference.sectors.includes(sector):!preference.sectors.includes(sector));result.vaastu.push({id:preference.id+':'+element.id,label:element.name,status:sector===null?'not-evaluated':matches?'matches-preference':'conflicts-with-preference',sector,preferred:preference.sectors,message:`${preference.mode==='prefer'?'Prefer':'Avoid'} ${preference.sectors.join(', ')}. Sector uses the element centre relative to the plot centre and entered true north; this is a user preference, not a legal rule.`,elementIds:[element.id]});}
  }
 }return result;
}
