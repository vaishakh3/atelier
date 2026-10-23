import type { Project, BimElement, ElementKind, ElementType } from './types';
export const uid = (prefix='id') => `${prefix}-${crypto.randomUUID()}`;
const rateDate='2026-10-24';
export const defaultTypes:ElementType[] = [
 {id:'wall-aac',name:'AAC block · 200 mm',kind:'wall',material:'AAC block',unit:'m²',materialRate:1180,labourRate:390,equipmentRate:35,wastePercent:5,approved:true,productivity:24,rateDate},
 {id:'wall-brick',name:'Clay brick · 200 mm',kind:'wall',material:'Clay brick',unit:'m²',materialRate:980,labourRate:520,equipmentRate:35,wastePercent:8,approved:true,productivity:18,rateDate},
 {id:'slab-concrete',name:'Concrete slab · 150 mm',kind:'slab',material:'Reinforced concrete',unit:'m²',materialRate:2050,labourRate:680,equipmentRate:180,wastePercent:4,approved:true,productivity:36,rateDate},
 {id:'window-standard',name:'Aluminium · standard',kind:'window',material:'Aluminium / clear glass',unit:'ea',materialRate:18500,labourRate:2100,equipmentRate:200,wastePercent:0,approved:true,productivity:6,rateDate},
 {id:'window-thermal',name:'Aluminium · thermal break',kind:'window',material:'Thermal-break aluminium',unit:'ea',materialRate:24500,labourRate:2250,equipmentRate:200,wastePercent:0,approved:true,productivity:5,rateDate},
 {id:'door-timber',name:'Timber · flush panel',kind:'door',material:'Engineered timber',unit:'ea',materialRate:14500,labourRate:1800,equipmentRate:0,wastePercent:0,approved:true,productivity:6,rateDate},
 {id:'room-default',name:'Room / area',kind:'room',material:'Not applicable',unit:'m²',materialRate:null,labourRate:null,equipmentRate:null,wastePercent:0,approved:true,productivity:1,rateDate},
 {id:'roof-concrete',name:'Flat roof · concrete',kind:'roof',material:'Concrete / waterproofing',unit:'m²',materialRate:2350,labourRate:720,equipmentRate:200,wastePercent:4,approved:true,productivity:30,rateDate},
 {id:'stair-concrete',name:'Stair · concrete',kind:'stair',material:'Reinforced concrete',unit:'ea',materialRate:48000,labourRate:16000,equipmentRate:2500,wastePercent:3,approved:true,productivity:0.5,rateDate}
];
function el(id:string,kind:ElementKind,name:string,x:number,y:number,width:number,depth:number,height:number,levelId='level-0',extra:Partial<BimElement>={}):BimElement {
 const type=defaultTypes.find(t=>t.kind===kind)!;
 return {id,kind,name,levelId,typeId:type?.id||'',material:type?.material||'',x,y,z:levelId==='level-1'?3.2:0,width,depth,height,rotation:0,editable:true,properties:{status:'Design development',classification:kind},...extra};
}
export function createDemoProject():Project {
 const elements:BimElement[]=[];
 for(const [lv,z,suffix] of [['level-0',0,'00'],['level-1',3.2,'01']] as const){
 elements.push(el(`slab-${suffix}`,'slab',`Floor slab ${suffix}`,0,0,12,9,0.18,lv,{z:z-0.18}));
 elements.push(el(`wall-n-${suffix}`,'wall',`North external wall ${suffix}`,0,0,12,0.2,2.9,lv));
 elements.push(el(`wall-e-${suffix}`,'wall',`East external wall ${suffix}`,12,0,9,0.2,2.9,lv,{rotation:90}));
 elements.push(el(`wall-s-${suffix}`,'wall',`South external wall ${suffix}`,0,8.8,12,0.2,2.9,lv));
 elements.push(el(`wall-w-${suffix}`,'wall',`West external wall ${suffix}`,0.2,0,9,0.2,2.9,lv,{rotation:90}));
 elements.push(el(`wall-mid-${suffix}`,'wall',`Central partition ${suffix}`,6.5,0.2,8.6,0.15,2.9,lv,{rotation:90}));
 elements.push(el(`wall-cross-${suffix}`,'wall',`East partition ${suffix}`,6.5,4.7,5.3,0.15,2.9,lv));
 elements.push(el(`wall-service-${suffix}`,'wall',`Service partition ${suffix}`,0.2,5.8,6.3,0.15,2.9,lv));
 elements.push(el(`window-n1-${suffix}`,'window',`W-${suffix}01`,1.4,-0.02,2.4,0.24,1.5,lv,{z:z+0.9,hostId:`wall-n-${suffix}`}));
 elements.push(el(`window-n2-${suffix}`,'window',`W-${suffix}02`,8.1,-0.02,2.4,0.24,1.5,lv,{z:z+0.9,hostId:`wall-n-${suffix}`}));
 elements.push(el(`window-s1-${suffix}`,'window',`W-${suffix}03`,1.3,8.78,2.8,0.24,1.5,lv,{z:z+0.9,hostId:`wall-s-${suffix}`}));
 elements.push(el(`window-s2-${suffix}`,'window',`W-${suffix}04`,8.1,8.78,2.2,0.24,1.5,lv,{z:z+0.9,hostId:`wall-s-${suffix}`}));
 elements.push(el(`window-e-${suffix}`,'window',`W-${suffix}05`,12.02,1.4,2,0.24,1.5,lv,{z:z+0.9,rotation:90,hostId:`wall-e-${suffix}`}));
 elements.push(el(`door-mid-${suffix}`,'door',`D-${suffix}01`,6.52,2.9,1,0.2,2.15,lv,{rotation:90,hostId:`wall-mid-${suffix}`}));
 elements.push(el(`door-cross-${suffix}`,'door',`D-${suffix}02`,8.5,4.68,0.9,0.2,2.15,lv,{hostId:`wall-cross-${suffix}`}));
 elements.push(el(`door-service-${suffix}`,'door',`D-${suffix}03`,2,5.78,0.9,0.2,2.15,lv,{hostId:`wall-service-${suffix}`}));
 }
 elements.push(el('door-entry','door','D-0000 · Entrance',4.9,8.78,1.2,0.24,2.3,'level-0',{hostId:'wall-s-00'}));
 elements.push(el('room-living','room','Living & dining',0.2,0.2,6.3,5.6,0.02,'level-0',{properties:{occupancy:'Residential',finish:'Oak flooring'}}));
 elements.push(el('room-kitchen','room','Kitchen',6.65,0.2,5.15,4.5,0.02));
 elements.push(el('room-study','room','Studio',6.65,4.85,5.15,3.95,0.02));
 elements.push(el('room-service','room','Entry & stair',0.2,5.95,6.3,2.85,0.02));
 elements.push(el('room-bed1','room','Primary bedroom',0.2,0.2,6.3,5.6,0.02,'level-1'));
 elements.push(el('room-bed2','room','Bedroom 02',6.65,0.2,5.15,4.5,0.02,'level-1'));
 elements.push(el('room-bed3','room','Bedroom 03',6.65,4.85,5.15,3.95,0.02,'level-1'));
 elements.push(el('room-landing','room','Landing & bath',0.2,5.95,6.3,2.85,0.02,'level-1'));
 elements.push(el('stair-main','stair','Main staircase',3.7,6.2,2.4,1.15,3.2,'level-0',{properties:{steps:16}}));
 elements.push(el('roof-main','roof','Roof slab',-0.15,-0.15,12.3,9.3,0.22,'level-1',{z:6.2,properties:{hiddenIn3d:true,slope:0}}));
 const now=new Date().toISOString();
 return {schemaVersion:1,id:uid('project'),name:'Courtyard House',description:'Two-storey residence · design development',location:'Residential pilot',units:'m',currency:'INR',version:1,createdAt:now,updatedAt:now,levels:[{id:'level-0',name:'Ground floor',elevation:0},{id:'level-1',name:'First floor',elevation:3.2}],grids:[{id:'gx0',axis:'x',value:0,label:'A'},{id:'gx1',axis:'x',value:6.5,label:'B'},{id:'gx2',axis:'x',value:12,label:'C'},{id:'gy0',axis:'y',value:0,label:'1'},{id:'gy1',axis:'y',value:4.7,label:'2'},{id:'gy2',axis:'y',value:9,label:'3'}],elements,types:structuredClone(defaultTypes),allowances:[{id:'a-foundation',name:'Foundations & groundworks · provisional',amount:350000,included:true},{id:'a-mep',name:'MEP installation · provisional',amount:260000,included:true},{id:'a-finishes',name:'Finishes & fittings · provisional',amount:420000,included:true},{id:'a-fees',name:'Permits, fees & site preparation',amount:null,included:true}],schedule:{startDate:'2026-11-02',workingDays:[1,2,3,4,5,6],crews:2,crewCostPerDay:0,overheadPerDay:1800,procurementDays:21,activities:[]},constraints:{budget:3500000,deadline:'2027-04-30',maxCrews:4,lockedElementIds:[],lockedProperties:[]},audit:[{id:uid('audit'),actor:'Studio',timestamp:now,action:'Created demonstration project · illustrative rates',affectedIds:[]}]};
}
export function createBlankProject(name:string):Project {const p=createDemoProject();return {...p,name:name||'Untitled project',description:'New residential project',elements:[],levels:[p.levels[0]],version:1,audit:[{id:uid('audit'),actor:'You',timestamp:new Date().toISOString(),action:'Created project',affectedIds:[]}]};}
