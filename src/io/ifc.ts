import type { BimElement, ElementKind, ImportReport, Project } from '../domain/types';
import { projectSchema } from '../domain/schema';

/** Deliberately bounded STEP interoperability: horizontal rectangular extrusions.
 * Geometry the authoring kernel cannot represent is never silently made editable. */
type Ref = { ref:number }; type Value = null|string|number|boolean|Ref|Value[]|{type:string;value:Value};
interface Entity { id:number; type:string; args:Value[] }
const classes:Record<string,ElementKind>={IFCWALL:'wall',IFCWALLSTANDARDCASE:'wall',IFCSLAB:'slab',IFCDOOR:'door',IFCWINDOW:'window',IFCSPACE:'room',IFCROOF:'roof',IFCSTAIR:'stair',IFCSTAIRFLIGHT:'stair'};
const ifcClass:Record<ElementKind,string>={wall:'IFCWALL',slab:'IFCSLAB',door:'IFCDOOR',window:'IFCWINDOW',room:'IFCSPACE',roof:'IFCROOF',stair:'IFCSTAIR',reference:'IFCBUILDINGELEMENTPROXY'};
const quote=(s:string)=>`'${s.replace(/[^\x20-\x7e]/g,c=>`\\X2\\${c.charCodeAt(0).toString(16).padStart(4,'0')}\\X0\\`).replace(/'/g,"''")}'`;
const num=(n:number)=>{if(!Number.isFinite(n))throw new Error('IFC export requires finite geometry');return Number.isInteger(n)?`${n}.`:String(Number(n.toFixed(9)));};
function guid(value:string){const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';let n=0n;for(let seed=0;seed<4;seed++){let h=2166136261+seed;for(const c of value)h=Math.imul(h^c.charCodeAt(0),16777619);n=(n<<32n)|BigInt(h>>>0);}let out='';for(let i=0;i<22;i++){out=alphabet[Number(n&63n)]+out;n>>=6n;}return out;}
const refs=(ids:number[])=>`(${ids.map(id=>`#${id}`).join(',')})`;

export function exportIfc(project:Project):string {
  const lines:string[]=[];const add=(type:string,args:string)=>{const id=lines.length+1;lines.push(`#${id}=${type}(${args});`);return id;};
  const pt=(x:number,y:number,z:number)=>add('IFCCARTESIANPOINT',`(${num(x)},${num(y)},${num(z)})`);
  const direction=(x:number,y:number,z:number)=>add('IFCDIRECTION',`(${num(x)},${num(y)},${num(z)})`);
  const origin=pt(0,0,0),up=direction(0,0,1),east=direction(1,0,0),axis=add('IFCAXIS2PLACEMENT3D',`#${origin},#${up},#${east}`);
  const context=add('IFCGEOMETRICREPRESENTATIONCONTEXT',`$,'Model',3,1.E-06,#${axis},$`);
  const unit=add('IFCSIUNIT','*,.LENGTHUNIT.,$,.METRE.'),units=add('IFCUNITASSIGNMENT',refs([unit]));
  const projectId=add('IFCPROJECT',`${quote(guid(project.id))},$,${quote(project.name)},${quote(project.description)},$,$,$,${refs([context])},#${units}`);
  const rootPlace=add('IFCLOCALPLACEMENT',`$,#${axis}`);
  const building=add('IFCBUILDING',`${quote(guid(project.id+'building'))},$,'Building',$,$,#${rootPlace},$,$,.ELEMENT.,$,$,$`);
  add('IFCRELAGGREGATES',`${quote(guid(project.id+'aggregate'))},$,$,$,#${projectId},${refs([building])}`);
  const scale=1; // Canonical geometry is always metres; project.units is display only.
  const levelMap=new Map<string,{entity:number;placement:number;elevation:number;products:number[]}>();
  for(const level of project.levels){const p=pt(0,0,level.elevation*scale);const a=add('IFCAXIS2PLACEMENT3D',`#${p},#${up},#${east}`);const place=add('IFCLOCALPLACEMENT',`#${rootPlace},#${a}`);const id=add('IFCBUILDINGSTOREY',`${quote(guid(level.id))},$,${quote(level.name)},$,$,#${place},$,$,.ELEMENT.,${num(level.elevation*scale)}`);levelMap.set(level.id,{entity:id,placement:place,elevation:level.elevation,products:[]});}
  if(levelMap.size)add('IFCRELAGGREGATES',`${quote(guid(project.id+'levels'))},$,$,$,#${building},${refs([...levelMap.values()].map(l=>l.entity))}`);
  const products=new Map<string,{id:number;place:number;shape:number;globalId:string}>();
  for(const e of project.elements){
    const level=levelMap.get(e.levelId);const p=pt(e.x*scale,e.y*scale,(e.z-(level?.elevation??0))*scale);const angle=e.rotation*Math.PI/180;const dir=direction(Math.cos(angle),Math.sin(angle),0);const a=add('IFCAXIS2PLACEMENT3D',`#${p},#${up},#${dir}`);const place=add('IFCLOCALPLACEMENT',`${level?`#${level.placement}`:`#${rootPlace}`},#${a}`);
    const boxSolid=(w:number,d:number,h:number,cx:number,cy:number)=>{const profileOrigin=add('IFCCARTESIANPOINT',`(${num(cx)},${num(cy)})`);const profilePlacement=add('IFCAXIS2PLACEMENT2D',`#${profileOrigin},$`);const profile=add('IFCRECTANGLEPROFILEDEF',`.AREA.,$,#${profilePlacement},${num(w)},${num(d)}`);return add('IFCEXTRUDEDAREASOLID',`#${profile},#${axis},#${up},${num(h)}`);};
    const steps=Math.floor(Math.min(32,Math.max(4,Number(e.properties.steps)||16)));
    const solids=e.kind==='stair'?Array.from({length:steps},(_,i)=>boxSolid(e.width,e.depth/steps,e.height*(i+1)/steps,e.width/2,e.depth*(i+.5)/steps)):[boxSolid(e.width,e.depth,e.height,e.width/2,e.depth/2)];
    const shape=add('IFCSHAPEREPRESENTATION',`#${context},'Body','SweptSolid',${refs(solids)}`);const representation=add('IFCPRODUCTDEFINITIONSHAPE',`$,$,${refs([shape])}`);
    const globalId=e.externalId&&/^[0-3][0-9A-Za-z_$]{21}$/.test(e.externalId)?e.externalId:guid(e.id);const common=`${quote(globalId)},$,${quote(e.name)},$,$,#${place},#${representation}`;
    let tail=',$,.NOTDEFINED.';if(e.kind==='window'||e.kind==='door')tail=`,${quote(e.id)},${num(e.height*scale)},${num(e.width*scale)},.NOTDEFINED.,.NOTDEFINED.,$`;else if(e.kind==='room')tail=',$,.ELEMENT.,.NOTDEFINED.,$';else if(e.kind==='reference')tail=',$,.NOTDEFINED.';
    const entity=add(ifcClass[e.kind],common+tail);products.set(e.id,{id:entity,place,shape:representation,globalId});level?.products.push(entity);
    const values:Record<string,string|number|boolean>={...e.properties,AtelierId:e.id,AtelierTypeId:e.typeId,Material:e.material,AtelierKind:e.kind,AtelierEditable:e.editable};if(e.externalId)values.AtelierExternalId=e.externalId;
    const properties=Object.entries(values).map(([key,value])=>add('IFCPROPERTYSINGLEVALUE',`${quote(key)},$,${typeof value==='number'?`IFCREAL(${num(value)})`:typeof value==='boolean'?`IFCBOOLEAN(${value?'.T.':'.F.'})`:`IFCTEXT(${quote(value)})`},$`));
    const pset=add('IFCPROPERTYSET',`${quote(guid(e.id+'pset'))},$,'Pset_Atelier',$,${refs(properties)}`);add('IFCRELDEFINESBYPROPERTIES',`${quote(guid(e.id+'properties'))},$,$,$,${refs([entity])},#${pset}`);
    if(e.material){const material=add('IFCMATERIAL',`${quote(e.material)},$,$`);add('IFCRELASSOCIATESMATERIAL',`${quote(guid(e.id+'material'))},$,$,$,${refs([entity])},#${material}`);}
  }
  for(const [id,e] of products){const element=project.elements.find(item=>item.id===id)!;const host=element.hostId&&products.get(element.hostId);if(host&&(element.kind==='door'||element.kind==='window')){const opening=add('IFCOPENINGELEMENT',`${quote(guid(id+'opening'))},$,'Opening',$,$,#${e.place},#${e.shape},$,.OPENING.`);add('IFCRELVOIDSELEMENT',`${quote(guid(id+'void'))},$,$,$,#${host.id},#${opening}`);add('IFCRELFILLSELEMENT',`${quote(guid(id+'fill'))},$,$,$,#${opening},#${e.id}`);}}
  for(const [key,l]of levelMap){const spaces=l.products.filter(id=>project.elements.some(e=>e.kind==='room'&&products.get(e.id)?.id===id)),physical=l.products.filter(id=>!spaces.includes(id));if(physical.length)add('IFCRELCONTAINEDINSPATIALSTRUCTURE',`${quote(guid(key+'contents'))},$,$,$,${refs(physical)},#${l.entity}`);if(spaces.length)add('IFCRELAGGREGATES',`${quote(guid(key+'spaces'))},$,$,$,#${l.entity},${refs(spaces)}`);}
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Atelier BIM rectangular extrusion pilot; unsupported reference geometry is a bounding proxy'),'2;1');\nFILE_NAME(${quote(project.name+'.ifc')},${quote(new Date().toISOString())},('Atelier'),('Atelier'),'Atelier','Atelier','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

function parseStep(text:string):Map<number,Entity>{
  if(text.length>20_000_000)throw new Error('IFC exceeds the 20 MB pilot limit');
  if(!/ISO-10303-21\s*;/i.test(text)||!/END-ISO-10303-21\s*;/i.test(text)||!/FILE_SCHEMA\s*\(\s*\(\s*'IFC(?:4[^']*|2X3)'/i.test(text))throw new Error('Expected a complete IFC4 or IFC2X3 STEP file');
  // Keep source offsets while ignoring comments and quoted text when locating sections.
  // STEP strings may legally contain semicolons, ENDSEC and comment-looking text.
  let masked='',uncommented='',quoted=false,comment=false;
  for(let i=0;i<text.length;i++){const c=text[i],next=text[i+1];if(comment){masked+=' ';uncommented+=' ';if(c==='*'&&next==='/'){i++;masked+=' ';uncommented+=' ';comment=false;}continue;}if(!quoted&&c==='/'&&next==='*'){comment=true;i++;masked+='  ';uncommented+='  ';continue;}uncommented+=c;if(c==="'"){masked+=' ';if(quoted&&next==="'"){i++;masked+=' ';uncommented+="'";}else quoted=!quoted;}else masked+=quoted?' ':c;}
  const start=masked.match(/\bDATA\s*;/i);const dataStart=start?.index===undefined?undefined:start.index+start[0].length;const end=dataStart===undefined?null:masked.slice(dataStart).match(/\bENDSEC\s*;/i);if(dataStart===undefined||end?.index===undefined)throw new Error('Missing IFC DATA section');
  const entities=new Map<number,Entity>();let pos=0;const clean=uncommented.slice(dataStart,dataStart+end.index);
  const space=()=>{while(/\s/.test(clean[pos]??'')&&pos<clean.length)pos++;};
  const parseValue=(depth=0):Value=>{if(depth>100)throw new Error('IFC nesting limit exceeded');space();const c=clean[pos++];if(c==='$'||c==='*')return null;if(c==="'"){let s='';while(pos<clean.length){const ch=clean[pos++];if(ch==="'"){if(clean[pos]==="'"){pos++;s+="'";}else return s.replace(/\\X2\\([0-9a-f]+)\\X0\\/gi,(_,hex:string)=>hex.match(/.{4}/g)!.map(h=>String.fromCharCode(parseInt(h,16))).join(''));}else s+=ch;}throw new Error('Unterminated IFC string');}if(c==='('){const list:Value[]=[];space();if(clean[pos]===')'){pos++;return list;}while(pos<clean.length){list.push(parseValue(depth+1));space();const delimiter=clean[pos++];if(delimiter===')')return list;if(delimiter!==',')throw new Error('Invalid IFC aggregate');}throw new Error('Unterminated IFC aggregate');}if(c==='#'){const match=clean.slice(pos).match(/^\d+/);if(!match)throw new Error('Invalid IFC reference');pos+=match[0].length;return{ref:Number(match[0])};}if(c==='.'){const rest=clean.slice(pos).match(/^[A-Z_][A-Z0-9_]*\./i);if(rest){pos+=rest[0].length;const token=rest[0].slice(0,-1);return token==='T'?true:token==='F'?false:token;}}
    pos--;const numeric=clean.slice(pos).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?/i);if(numeric){pos+=numeric[0].length;const value=Number(numeric[0]);if(!Number.isFinite(value))throw new Error('Non-finite IFC number');return value;}const typed=clean.slice(pos).match(/^[A-Z][A-Z0-9_]*/i);if(typed){pos+=typed[0].length;const value=parseValue(depth+1);return{type:typed[0].toUpperCase(),value:Array.isArray(value)&&value.length===1?value[0]:value};}throw new Error(`Invalid IFC value near offset ${pos}`);};
  while(pos<clean.length){space();if(pos>=clean.length)break;const header=clean.slice(pos).match(/^#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\s*/i);if(!header)throw new Error(`Malformed IFC entity near offset ${pos}`);pos+=header[0].length;const args=parseValue();space();if(clean[pos++]!==';'||!Array.isArray(args))throw new Error('Malformed IFC entity terminator');const id=Number(header[1]);if(entities.has(id))throw new Error('Duplicate IFC entity identifier');entities.set(id,{id,type:header[2].toUpperCase(),args});if(entities.size>200_000)throw new Error('IFC entity limit exceeded');}
  return entities;
}
const refId=(v:Value|undefined)=>v&&typeof v==='object'&&!Array.isArray(v)&&'ref'in v?v.ref:undefined;
const primitive=(v:Value|undefined):string|number|boolean|null=>v&&typeof v==='object'&&!Array.isArray(v)&&'type'in v?primitive(v.value):typeof v==='string'||typeof v==='number'||typeof v==='boolean'?v:null;
type Vec=[number,number,number];type Frame={o:Vec;x:Vec;y:Vec;z:Vec};
const identity=():Frame=>({o:[0,0,0],x:[1,0,0],y:[0,1,0],z:[0,0,1]});
const cross=(a:Vec,b:Vec):Vec=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(v:Vec):Vec=>{const n=Math.hypot(...v);if(n<1e-9)throw new Error('Invalid zero IFC direction');return v.map(x=>x/n)as Vec;};
const vector=(f:Frame,p:Vec):Vec=>[0,1,2].map(i=>f.x[i]*p[0]+f.y[i]*p[1]+f.z[i]*p[2])as Vec;
const point=(f:Frame,p:Vec):Vec=>vector(f,p).map((x,i)=>x+f.o[i])as Vec;
const combine=(a:Frame,b:Frame):Frame=>({o:point(a,b.o),x:vector(a,b.x),y:vector(a,b.y),z:vector(a,b.z)});

export function importIfc(text:string,baseProject:Project):{project:Project;report:ImportReport}{
  const db=parseStep(text);const get=(v:Value|undefined)=>{const id=refId(v);return id===undefined?undefined:db.get(id);};
  const entries=[...db.values()];let scale=1;const prefixes:Record<string,number>={MILLI:0.001,CENTI:0.01,DECI:0.1,KILO:1000};
  const lengthUnit=entries.find(e=>e.type==='IFCSIUNIT'&&e.args[1]==='LENGTHUNIT');if(lengthUnit)scale=prefixes[String(lengthUnit.args[2])]??1;
  const conversion=entries.find(e=>e.type==='IFCCONVERSIONBASEDUNIT'&&e.args[1]==='LENGTHUNIT');if(conversion){const measure=get(conversion.args[3]);const factor=primitive(measure?.args[0]);if(typeof factor==='number')scale=factor;}
  const unitFactor=scale;
  const coords=(v:Value|undefined,defaultValue:Vec):Vec=>{const e=get(v);const arr=e?.args[0];return Array.isArray(arr)?[Number(arr[0]??0),Number(arr[1]??0),Number(arr[2]??0)]:defaultValue;};
  const axisFrame=(v:Value|undefined):Frame=>{const e=get(v);if(!e)return identity();if(e.type==='IFCAXIS2PLACEMENT2D'){const d=norm(coords(e.args[1],[1,0,0]));return{o:coords(e.args[0],[0,0,0]),x:d,y:[-d[1],d[0],0],z:[0,0,1]};}if(e.type!=='IFCAXIS2PLACEMENT3D')throw new Error('Unsupported IFC placement');const z=norm(coords(e.args[1],[0,0,1])),x=norm(coords(e.args[2],[1,0,0])),y=norm(cross(z,x));return{o:coords(e.args[0],[0,0,0]),x:norm(cross(y,z)),y,z};};
  const localFrame=(v:Value|undefined,seen=new Set<number>()):Frame=>{const e=get(v);if(!e)return identity();if(seen.has(e.id)||seen.size>100)throw new Error('Cyclic IFC placement');seen.add(e.id);if(e.type!=='IFCLOCALPLACEMENT')throw new Error('Unsupported IFC placement');return combine(localFrame(e.args[0],seen),axisFrame(e.args[1]));};
  const props=new Map<number,Record<string,string|number|boolean>>();for(const relation of entries.filter(e=>e.type==='IFCRELDEFINESBYPROPERTIES')){const pset=get(relation.args[5]);if(pset?.type!=='IFCPROPERTYSET'||!Array.isArray(pset.args[4])||!Array.isArray(relation.args[4]))continue;const values:Record<string,string|number|boolean>={};for(const p of pset.args[4]){const property=get(p);if(property?.type==='IFCPROPERTYSINGLEVALUE'){const val=primitive(property.args[2]);if(val!==null&&typeof property.args[0]==='string'&&!['__proto__','constructor','prototype'].includes(property.args[0]))values[property.args[0]]=val;}}for(const target of relation.args[4]){const id=refId(target);if(id!==undefined)props.set(id,{...props.get(id),...values});}}
  for(const relation of entries.filter(e=>e.type==='IFCRELASSOCIATESMATERIAL')){const material=get(relation.args[5]);if(material?.type==='IFCMATERIAL'&&typeof material.args[0]==='string'&&Array.isArray(relation.args[4]))for(const target of relation.args[4]){const id=refId(target);if(id!==undefined&&!props.get(id)?.Material)props.set(id,{...props.get(id),Material:material.args[0]});}}
  const levelByEntity=new Map<number,string>();const levels=entries.filter(e=>e.type==='IFCBUILDINGSTOREY').map(e=>{const id=`ifc-level-${String(e.args[0])}`;levelByEntity.set(e.id,id);let elevation=Number(e.args[9]??0);try{elevation=localFrame(e.args[5]).o[2];}catch{/* elevation attribute remains */}return{id,name:String(e.args[2]??'Imported level'),elevation:elevation*unitFactor};});
  if(!levels.length)levels.push(...(baseProject.levels.length?baseProject.levels:[{id:'ifc-level-0',name:'Ground',elevation:0}]));
  const containment=new Map<number,string>();for(const rel of entries.filter(e=>e.type==='IFCRELCONTAINEDINSPATIALSTRUCTURE'||e.type==='IFCRELAGGREGATES')){const products=rel.type==='IFCRELAGGREGATES'?rel.args[5]:rel.args[4],structure=rel.type==='IFCRELAGGREGATES'?rel.args[4]:rel.args[5];const id=refId(structure),level=id&&levelByEntity.get(id);if(level&&Array.isArray(products))for(const child of products){const key=refId(child);if(key)containment.set(key,level);}}
  const report:ImportReport={schema:text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1]??'IFC',imported:0,referenceOnly:0,excluded:0,classes:[],warnings:[]};const elements:BimElement[]=[];const newTypes=[...baseProject.types];const idByEntity=new Map<number,string>();
  const candidates=entries.filter(e=>classes[e.type]||(e.args.length>=7&&get(e.args[5])?.type==='IFCLOCALPLACEMENT'&&get(e.args[6])?.type==='IFCPRODUCTDEFINITIONSHAPE'&&!['IFCBUILDING','IFCSITE','IFCBUILDINGSTOREY','IFCOPENINGELEMENT'].includes(e.type)));
  for(const entity of candidates){let tally=report.classes.find(c=>c.name===entity.type);if(!tally){tally={name:entity.type,count:0,editable:0,referenceOnly:0};report.classes.push(tally);}tally.count++;const p=props.get(entity.id)??{};try{
    const placement=localFrame(entity.args[5]),representation=get(entity.args[6]);const shapeRefs=representation?.args[2];const shapes=Array.isArray(shapeRefs)?shapeRefs.map(get).filter(Boolean):[];const body=shapes.find(e=>e?.args[0]&&e.args[1]==='Body')??shapes[0];const items=body?.args[3];const solid=Array.isArray(items)&&items.length===1?get(items[0]):undefined;const profile=solid?.type==='IFCEXTRUDEDAREASOLID'?get(solid.args[0]):undefined;let width=0,depth=0,height=0,frame=placement,editable=false;
    if(profile?.type==='IFCRECTANGLEPROFILEDEF'&&solid){frame=combine(combine(placement,axisFrame(solid.args[1])),axisFrame(profile.args[2]));const extrusion=vector(combine(placement,axisFrame(solid.args[1])),norm(coords(solid.args[2],[0,0,1])));editable=Boolean(classes[entity.type])&&Math.abs(extrusion[2]-1)<1e-6&&Math.abs(frame.x[2])<1e-6&&Math.abs(frame.y[2])<1e-6;width=Number(profile.args[3]);depth=Number(profile.args[4]);height=Number(solid.args[3]);}
    if(classes[entity.type]==='stair'&&Array.isArray(items)&&items.length>=4&&items.length<=32){
      const steps=items.map(value=>{const step=get(value);if(step?.type!=='IFCEXTRUDEDAREASOLID')return null;const shape=get(step.args[0]);if(shape?.type!=='IFCRECTANGLEPROFILEDEF')return null;const local=combine(axisFrame(step.args[1]),axisFrame(shape.args[2]));const direction=vector(axisFrame(step.args[1]),norm(coords(step.args[2],[0,0,1])));return{frame:local,w:Number(shape.args[3]),d:Number(shape.args[4]),h:Number(step.args[3]),direction};});
      const first=steps[0],last=steps[steps.length-1];
      if(first&&last&&steps.every((step,i)=>step&&Math.abs(step.w-first.w)<1e-6&&Math.abs(step.d-first.d)<1e-6&&Math.abs(step.h-first.h*(i+1))<1e-6&&Math.abs(step.frame.o[0]-first.frame.o[0])<1e-6&&Math.abs(step.frame.o[1]-(first.frame.o[1]+i*first.d))<1e-6&&Math.abs(step.frame.o[2]-first.frame.o[2])<1e-6&&Math.abs(step.frame.x[0]-1)<1e-6&&Math.abs(step.frame.y[1]-1)<1e-6&&Math.abs(step.direction[2]-1)<1e-6)&&Math.abs(placement.z[2]-1)<1e-6){
        width=first.w;depth=first.d*steps.length;height=last.h;frame={...placement,o:point(placement,[first.frame.o[0],first.frame.o[1]+depth/2-first.d/2,first.frame.o[2]])};editable=true;
        if(!('steps'in p))p.steps=steps.length;
      }
    }
    if(!editable){
      const points:Vec[]=[];
      if(profile?.type==='IFCRECTANGLEPROFILEDEF'&&solid){
        const extrusion=vector(combine(placement,axisFrame(solid.args[1])),norm(coords(solid.args[2],[0,0,1])));
        for(const x of [-width/2,width/2])for(const y of [-depth/2,depth/2])for(const h of [0,height])points.push(point(frame,[x,y,0]).map((v,i)=>v+extrusion[i]*h)as Vec);
      }else{
        const allowed=new Set(['IFCFACETEDBREP','IFCFACEBASEDSURFACEMODEL','IFCSHELLBASEDSURFACEMODEL','IFCTRIANGULATEDFACESET','IFCPOLYGONALFACESET','IFCBOUNDINGBOX']);
        if(!Array.isArray(items)||!items.length||items.some(v=>!allowed.has(get(v)?.type??'')))throw new Error('Unsupported geometry has no safely reconstructable bounding proxy');
        const visited=new Set<number>();
        const collect=(v:Value|undefined,nesting=0)=>{if(nesting>60)return;if(Array.isArray(v)){for(const value of v)collect(value,nesting+1);return;}const e=get(v);if(!e||visited.has(e.id))return;visited.add(e.id);
          if(e.type==='IFCCARTESIANPOINT'&&Array.isArray(e.args[0]))points.push(point(placement,[Number(e.args[0][0]??0),Number(e.args[0][1]??0),Number(e.args[0][2]??0)]));
          else if(e.type==='IFCCARTESIANPOINTLIST3D'&&Array.isArray(e.args[0]))for(const p of e.args[0]){if(Array.isArray(p))points.push(point(placement,[Number(p[0]??0),Number(p[1]??0),Number(p[2]??0)]));}
          else if(e.type==='IFCBOUNDINGBOX'){const corner=coords(e.args[0],[0,0,0]);for(const x of [0,Number(e.args[1])])for(const y of [0,Number(e.args[2])])for(const z of [0,Number(e.args[3])])points.push(point(placement,[corner[0]+x,corner[1]+y,corner[2]+z]));}
          else for(const arg of e.args)collect(arg,nesting+1);
        };for(const item of items)collect(item);
      }
      if(points.length<2)throw new Error('Unsupported geometry has no reliable bounding proxy');
      const min=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max=[0,1,2].map(i=>Math.max(...points.map(p=>p[i])));
      width=max[0]-min[0];depth=max[1]-min[1];height=max[2]-min[2];frame={...identity(),o:[(min[0]+max[0])/2,(min[1]+max[1])/2,min[2]]};
      report.warnings.push(`${String(entity.args[2]??entity.type)}: unsupported ${solid?.type??String(body?.args[2]??'geometry')} imported as read-only bounding proxy; source geometry is not reconstructed.`);
    }
    if(![width,depth,height,...frame.o].every(Number.isFinite)||Math.min(width,depth,height)<=0)throw new Error('Missing or invalid dimensions');
    const id=String(p.AtelierId??`ifc-${String(entity.args[0])}`);if(elements.some(e=>e.id===id))throw new Error('Duplicate product ID');const kind=editable?classes[entity.type]:'reference';const typeId=String(p.AtelierTypeId??`ifc-type-${kind}-${String(p.Material??'unspecified').replace(/[^\w-]/g,'-')}`);if(!newTypes.some(t=>t.id===typeId))newTypes.push({id:typeId,name:`Imported ${kind}`,kind,material:String(p.Material??''),unit:kind==='window'||kind==='door'||kind==='stair'?'ea':kind==='wall'||kind==='slab'?'m³':'m²',materialRate:null,labourRate:null,equipmentRate:null,wastePercent:0,approved:false,productivity:1,rateDate:new Date().toISOString().slice(0,10)});
    const custom={...p};for(const key of ['AtelierId','AtelierTypeId','AtelierKind','AtelierEditable','AtelierExternalId','Material'])delete custom[key];
    elements.push({id,externalId:String(p.AtelierExternalId??entity.args[0]),kind,name:String(entity.args[2]??'Imported '+kind),levelId:containment.get(entity.id)??levels.reduce((best,l)=>Math.abs(l.elevation-frame.o[2]*unitFactor)<Math.abs(best.elevation-frame.o[2]*unitFactor)?l:best,levels[0]).id,typeId,material:String(p.Material??''),x:(frame.o[0]-frame.x[0]*width/2-frame.y[0]*depth/2)*unitFactor,y:(frame.o[1]-frame.x[1]*width/2-frame.y[1]*depth/2)*unitFactor,z:frame.o[2]*unitFactor,width:width*unitFactor,depth:depth*unitFactor,height:height*unitFactor,rotation:Math.atan2(frame.x[1],frame.x[0])*180/Math.PI,editable:editable&&p.AtelierEditable!==false,properties:{...custom,...(!editable?{ifcSourceClass:entity.type,referenceGeometry:'Bounding proxy only'}:{})}});idByEntity.set(entity.id,id);if(editable){report.imported++;tally.editable++;}else{report.referenceOnly++;tally.referenceOnly++;}
  }catch(error){report.excluded++;report.warnings.push(`${String(entity.args[2]??entity.type)} (#${entity.id}) excluded: ${error instanceof Error?error.message:'unsupported geometry'}`);}}
  const openingHost=new Map<number,number>();for(const rel of entries.filter(e=>e.type==='IFCRELVOIDSELEMENT')){const opening=refId(rel.args[5]),host=refId(rel.args[4]);if(opening&&host)openingHost.set(opening,host);}for(const rel of entries.filter(e=>e.type==='IFCRELFILLSELEMENT')){const opening=refId(rel.args[4]),filled=refId(rel.args[5]),host=opening&&openingHost.get(opening);const target=elements.find(e=>e.id===idByEntity.get(filled??-1));if(target&&host)target.hostId=idByEntity.get(host);}
  if(!candidates.length)report.warnings.push('No supported products or geometric proxies were found.');
  if(!lengthUnit&&!conversion)report.warnings.push('No declared IFC length unit was found; coordinates are assumed to be metres. Confirm scale before using quantities.');
  report.warnings.unshift('Pilot support: IFC4/IFC2X3 horizontal rectangular extrusions, regular straight stair flights and nested local placements. Curved, mapped, boolean and tessellated geometry is reference-only where a bounding proxy can be recovered, otherwise excluded.');
  const project={...structuredClone(baseProject),name:String(entries.find(e=>e.type==='IFCPROJECT')?.args[2]??baseProject.name),elements,levels,types:newTypes,updatedAt:new Date().toISOString()};
  const checked=projectSchema.safeParse(project);
  if(!checked.success)throw new Error('Imported IFC metadata exceeds the supported project schema or limits. The current project was not changed.');
  return{project:checked.data,report};
}
