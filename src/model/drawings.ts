import type { BimElement, Project } from '../domain/types';
import { footprint, formatDistance, localToWorld } from './geometry';
import type { Point2 } from './geometry';

export interface DrawingPrimitive {
  kind:'polygon'|'polyline'|'text'; points:Point2[]; stroke:string; fill?:string;
  width?:number; dashed?:boolean; text?:string; fontSize?:number; anchor?:'start'|'middle'|'end';
  elementId?:string;
  sourceProperty?:'properties.annotation';
}
export interface DrawingData {
  title:string; subtitle:string; primitives:DrawingPrimitive[];
  bounds:{minX:number;minY:number;maxX:number;maxY:number}; empty:boolean; elementCount:number;
}
const layer:Record<BimElement['kind'],number>={slab:0,roof:1,room:2,reference:3,wall:4,stair:5,window:6,door:7};
const polygon=(points:Point2[],fill='#f4f2ec',stroke='#6b6b74',width=.02,dashed=false):DrawingPrimitive=>({kind:'polygon',points,stroke,fill,width,dashed});
const line=(points:Point2[],stroke='#9b99a3',width=.015,dashed=false):DrawingPrimitive=>({kind:'polyline',points,stroke,width,dashed});
const text=(point:Point2,value:string,size=.2,anchor:'start'|'middle'|'end'='middle'):DrawingPrimitive=>({kind:'text',points:[point],text:value,stroke:'#777580',fontSize:size,anchor});
export function drawingBounds(primitives:DrawingPrimitive[]):DrawingData['bounds'] {
  const points=primitives.flatMap(p=>{
    if(p.kind!=='text'||!p.points[0])return p.points;
    const origin=p.points[0],width=(p.text?.length??0)*(p.fontSize??.2)*.55,height=p.fontSize??.2;
    const left=p.anchor==='start'?origin.x:p.anchor==='end'?origin.x-width:origin.x-width/2;
    return[{x:left,y:origin.y-height},{x:left+width,y:origin.y+height*.2}];
  }).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!points.length)return{minX:0,minY:0,maxX:12,maxY:9};
  return{minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y))};
}
function dimensions(bounds:DrawingData['bounds'],units:Project['units']):DrawingPrimitive[] {
  const {minX,minY,maxX,maxY}=bounds,dy=maxY+.55;
  return[line([{x:minX,y:dy},{x:maxX,y:dy}]),line([{x:minX,y:dy-.1},{x:minX,y:dy+.1}]),line([{x:maxX,y:dy-.1},{x:maxX,y:dy+.1}]),text({x:(minX+maxX)/2,y:dy+.3},formatDistance(maxX-minX,units),.18),line([{x:minX-.55,y:minY},{x:minX-.55,y:maxY}]),line([{x:minX-.65,y:minY},{x:minX-.45,y:minY}]),line([{x:minX-.65,y:maxY},{x:minX-.45,y:maxY}]),text({x:minX-.7,y:(minY+maxY)/2},formatDistance(maxY-minY,units),.18,'end')];
}
/** Short manual drawing notes remain associated with their source model elements. */
export function createPlanAnnotations(project:Project,levelId:string,reserved:DrawingPrimitive[]=[]):DrawingPrimitive[] {
  const elements=project.elements.filter(e=>e.levelId===levelId),result:DrawingPrimitive[]=[];
  const occupied=[...reserved.filter(p=>p.kind==='text').map(p=>drawingBounds([p])),...elements.filter(e=>e.kind==='wall'||e.kind==='stair').map(e=>drawingBounds([polygon(footprint(e))]))];
  if(!reserved.length)for(const room of elements.filter(e=>e.kind==='room')){const centre=localToWorld(room,room.width/2,room.depth/2);occupied.push({minX:centre.x-room.name.length*.065,maxX:centre.x+room.name.length*.065,minY:centre.y-.3,maxY:centre.y+.4});}
  const overlaps=(box:DrawingData['bounds'])=>occupied.some(other=>box.maxX>other.minX-.08&&box.minX<other.maxX+.08&&box.maxY>other.minY-.08&&box.minY<other.maxY+.08);
  for(const element of elements){
    if(typeof element.properties.annotation!=='string'||!element.properties.annotation.trim())continue;
    const note=element.properties.annotation.trim().slice(0,120),lines:string[]=[];
    for(const word of note.split(/\s+/).flatMap(word=>word.match(/.{1,30}/g)??[])){if(!lines.length||`${lines[lines.length-1]} ${word}`.length>30)lines.push(word);else lines[lines.length-1]+=` ${word}`;}
    const box=drawingBounds([polygon(footprint(element))]),centre={x:(box.minX+box.maxX)/2,y:(box.minY+box.maxY)/2};
    const vertical=element.kind==='wall'&&box.maxY-box.minY>box.maxX-box.minX;
    const candidates:{point:Point2;anchor:'start'|'middle'|'end'}[]=element.kind==='room'?[{point:{x:centre.x,y:centre.y+.7},anchor:'middle'},{point:{x:centre.x,y:box.minY+.5},anchor:'middle'},{point:{x:centre.x,y:box.maxY-.4},anchor:'middle'}]:vertical?[{point:{x:box.maxX+.35,y:centre.y},anchor:'start'},{point:{x:box.minX-.35,y:centre.y},anchor:'end'},{point:{x:centre.x,y:box.minY-.8},anchor:'middle'}]:[{point:{x:centre.x,y:box.minY-(element.kind==='wall'?.85:.4)},anchor:'middle'},{point:{x:centre.x,y:box.maxY+.5},anchor:'middle'},{point:{x:box.maxX+.35,y:centre.y},anchor:'start'}];
    const primitives=(candidate:typeof candidates[number])=>lines.map((value,i)=>({...text({x:candidate.point.x,y:candidate.point.y+i*.21},value,.16,candidate.anchor),stroke:'#7c6d91',elementId:element.id,sourceProperty:'properties.annotation' as const}));
    let chosen=candidates.find(candidate=>!overlaps(drawingBounds(primitives(candidate))))??candidates[0];
    for(let attempt=0;attempt<12&&overlaps(drawingBounds(primitives(chosen)));attempt++)chosen={...chosen,point:{x:chosen.point.x,y:chosen.point.y-.3}};
    const labels=primitives(chosen);result.push(...labels);occupied.push(drawingBounds(labels));
  }
  return result;
}
export function createPlanDrawing(project:Project,levelId:string,withDimensions=true):DrawingData {
  const level=project.levels.find(l=>l.id===levelId);
  const elements=project.elements.filter(e=>e.levelId===levelId).sort((a,b)=>layer[a.kind]-layer[b.kind]);
  const primitives:DrawingPrimitive[]=[];
  for(const e of elements) {
    const toWorld=(x:number,y:number)=>localToWorld(e,x,y);
    if(e.kind==='room') {
      primitives.push(polygon(footprint(e),'#f2f0e9','none'));
      const fontSize=Math.max(.13,Math.min(.24,e.width/12)),labelWidth=e.name.length*fontSize*.55;
      const blockers=elements.filter(element=>element.kind==='stair'||element.kind==='wall').map(element=>drawingBounds([polygon(footprint(element))]));
      const candidates=[[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75]].map(([x,y])=>toWorld(e.width*x,e.depth*y));
      const labelPoint=candidates.find(point=>!blockers.some(blocker=>point.x+labelWidth/2>blocker.minX&&point.x-labelWidth/2<blocker.maxX&&point.y+.35>blocker.minY&&point.y-.3<blocker.maxY))??candidates[0];
      primitives.push(text({x:labelPoint.x,y:labelPoint.y-.09},e.name,fontSize));
      const area=e.width*e.depth*(project.units==='ft'?10.7639104:1);
      primitives.push(text({x:labelPoint.x,y:labelPoint.y+.24},`${area.toFixed(1)} ${project.units==='ft'?'ft²':'m²'}`,.17));
    }else if(e.kind==='wall')primitives.push(polygon(footprint(e),'#777681','#55545f',.025));
    else if(e.kind==='window') {
      primitives.push(polygon(footprint(e),'#e4eef0','#7c9ba3',.025));
      primitives.push(line([toWorld(0,e.depth/2),toWorld(e.width,e.depth/2)],'#7b98a3',.02));
    }else if(e.kind==='door') {
      primitives.push(polygon(footprint(e),'#ffffff','none'));
      primitives.push(line([toWorld(0,e.depth/2),toWorld(0,e.depth/2+e.width)],'#ae957c',.025));
      primitives.push(line(Array.from({length:15},(_,i)=>{const a=i/14*Math.PI/2;return toWorld(e.width*Math.cos(a),e.depth/2+e.width*Math.sin(a));}),'#b8a18b',.018));
    }else if(e.kind==='stair') {
      primitives.push(polygon(footprint(e),'#eee8dd','#8f887f'));
      const count=Math.round(Math.min(32,Math.max(4,Number(e.properties.steps)||16)));
      for(let i=1;i<count;i++)primitives.push(line([toWorld(0,e.depth*i/count),toWorld(e.width,e.depth*i/count)],'#b1a99d',.015));
      primitives.push(line([toWorld(e.width/2,e.depth-.1),toWorld(e.width/2,.1),toWorld(e.width/2-.1,.3)],'#9a9286'));
    }else primitives.push(polygon(footprint(e),e.kind==='slab'?'#fbfaf7':'none',e.kind==='reference'?'#adb4bc':'#aaa7a0',.018,e.kind!=='slab'));
  }
  if(withDimensions&&elements.length)primitives.push(...dimensions(drawingBounds(elements.map(e=>polygon(footprint(e)))),project.units));
  primitives.push(...createPlanAnnotations(project,levelId,primitives));
  return{title:`${level?.name??'Unknown level'} plan`,subtitle:`Level ${formatDistance(level?.elevation??0,project.units)} | Model-derived architectural plan`,primitives,bounds:drawingBounds(primitives),empty:!elements.length,elementCount:elements.length};
}

/** Exact intersection of a rotated rectangular footprint with a horizontal plan cut. */
export function footprintSection(points:Point2[],cutY:number):{min:number;max:number}|null {
  const hits:number[]=[],epsilon=1e-7;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    if(Math.abs(a.y-cutY)<epsilon)hits.push(a.x);
    if((a.y<cutY&&b.y>cutY)||(a.y>cutY&&b.y<cutY))hits.push(a.x+(b.x-a.x)*(cutY-a.y)/(b.y-a.y));
  }
  if(!hits.length)return null;
  return{min:Math.min(...hits),max:Math.max(...hits)};
}
export function createProjectionDrawing(project:Project,mode:'section'|'elevation',withDimensions=true):DrawingData {
  const geometry=project.elements.filter(e=>e.kind!=='room');
  const planBounds=drawingBounds(geometry.map(e=>polygon(footprint(e))));
  const cutY=(planBounds.minY+planBounds.maxY)/2;
  const primitives:DrawingPrimitive[]=[];
  const elements=[...geometry].sort((a,b)=>Math.max(...footprint(a).map(p=>p.y))-Math.max(...footprint(b).map(p=>p.y))||layer[a.kind]-layer[b.kind]);
  function rect(min:number,max:number,z:number,height:number,fill:string,stroke='#8e8a91',dashed=false){if(max-min>1e-7)primitives.push(polygon([{x:min,y:-z-height},{x:max,y:-z-height},{x:max,y:-z},{x:min,y:-z}],fill,stroke,.022,dashed));}
  for(const e of elements) {
    const start=primitives.length;
    if(e.kind==='stair') {
      const count=Math.round(Math.min(32,Math.max(4,Number(e.properties.steps)||16)));
      for(let i=0;i<count;i++) {
        const points=[[0,e.depth*i/count],[e.width,e.depth*i/count],[e.width,e.depth*(i+1)/count],[0,e.depth*(i+1)/count]].map(([x,y])=>localToWorld(e,x,y));
        const slice=mode==='section'?footprintSection(points,cutY):{min:Math.min(...points.map(p=>p.x)),max:Math.max(...points.map(p=>p.x))};
        if(slice)rect(slice.min,slice.max,e.z,e.height*(i+1)/count,'#d9cebc');
      }
      for(let i=start;i<primitives.length;i++)primitives[i].elementId=e.id;
      continue;
    }
    const points=footprint(e),slice=mode==='section'?footprintSection(points,cutY):{min:Math.min(...points.map(p=>p.x)),max:Math.max(...points.map(p=>p.x))};
    if(!slice)continue;
    const fill=e.kind==='window'?'#dfebee':e.kind==='door'?'#d8c6ad':e.kind==='wall'?'#eeeae1':e.kind==='reference'?'none':'#d9d5ca';
    rect(slice.min,slice.max,e.z,e.height,fill,e.kind==='reference'?'#aab0b7':'#8e8a91',e.kind==='reference');
    if(e.kind==='window')primitives.push(line([{x:(slice.min+slice.max)/2,y:-e.z},{x:(slice.min+slice.max)/2,y:-e.z-e.height}],'#91a8ae',.02));
    for(let i=start;i<primitives.length;i++)primitives[i].elementId=e.id;
  }
  const geometryBounds=drawingBounds(primitives);
  if(geometry.length) {
    primitives.push(line([{x:planBounds.minX-.6,y:0},{x:planBounds.maxX+.6,y:0}],'#77737d',.025));
    for(const level of project.levels) {
      primitives.push(line([{x:planBounds.minX-.3,y:-level.elevation},{x:planBounds.maxX+.8,y:-level.elevation}],'#b8b5bf',.012,true));
      primitives.push(text({x:planBounds.maxX+1,y:-level.elevation-.08},`${level.name} +${formatDistance(level.elevation,project.units)}`,.16,'start'));
    }
    if(withDimensions)primitives.push(...dimensions(geometryBounds,project.units));
  }
  return{title:mode==='section'?'Building section A-A':'South elevation',subtitle:mode==='section'?`Geometric section at Y = ${formatDistance(cutY,project.units)} | Architectural review only`:'Orthographic projection looking north | Architectural review only',primitives,bounds:drawingBounds(primitives),empty:!geometry.length,elementCount:geometry.length};
}
