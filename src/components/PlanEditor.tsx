import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { Compass, Minus, Plus, Scan } from 'lucide-react';
import type { BimElement, Project, ViewMode } from '../domain/types';
import { createDrawnElement, formatDistance, modelBounds, snap } from '../model/geometry';
import type { Point2 } from '../model/geometry';
import { createPlanAnnotations, createProjectionDrawing, drawingBounds } from '../model/drawings';
import type { DrawingPrimitive } from '../model/drawings';

export interface ModelViewportProps {
  project:Project; selectedIds:string[]; onSelect:(ids:string[])=>void; viewMode:ViewMode;
  activeLevelId:string; tool:string; onCreate:(element:BimElement)=>void;
  onUpdate:(id:string,patch:Partial<BimElement>)=>void; showGrid:boolean; ghostUpper:boolean; fitKey:number;
}
type Drawing={start:Point2;end:Point2};
type Dragging={id:string;start:Point2;original:BimElement;delta:Point2};
const layerOrder:Record<string,number>={slab:0,roof:1,room:2,reference:3,stair:4,wall:5,window:6,door:7};
const selectedColor='#6654e8';
function PlanElement({element:e,selected,onPointerDown,onActivate,units}:{element:BimElement;selected:boolean;onPointerDown:(event:ReactPointerEvent<SVGGElement>)=>void;onActivate:()=>void;units:'m'|'ft'}) {
  const common={onPointerDown,onKeyDown:(event:React.KeyboardEvent<SVGGElement>)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onActivate();}},role:'button',tabIndex:0,'aria-label':`${e.name}, ${e.kind}`,'aria-pressed':selected};
  const stroke=selected?selectedColor:e.editable?'#626775':'#a4a7b2';
  const stepCount=Math.round(Math.min(32,Math.max(4,Number(e.properties.steps)||16)));
  return <g {...common} className={`plan-element ${selected?'is-selected':''}`} transform={`translate(${e.x} ${e.y}) rotate(${e.rotation})`} style={{cursor:e.editable?'move':'pointer'}}>
    <title>{`${e.name} · ${e.material} · ${formatDistance(e.width,units)} × ${formatDistance(e.depth,units)}`}</title>
    {e.kind==='wall'?<><rect width={e.width} height={e.depth} fill={selected?'#9584f1':'#57596a'} stroke={selected?selectedColor:'#414453'} strokeWidth={selected?.065:.025}/>{selected&&<><line x1={0} y1={-.32} x2={e.width} y2={-.32} stroke={selectedColor} strokeWidth={.018}/><path d={`M0,-.43 v.22 M${e.width},-.43 v.22`} stroke={selectedColor} strokeWidth={.018}/><text x={e.width/2} y={-.42} textAnchor="middle" fill={selectedColor} fontSize={.18}>{formatDistance(e.width,units)}</text></>}</>
      :e.kind==='window'?<><rect x={-.015} y={-.025} width={e.width+.03} height={e.depth+.05} fill="#f8fafc"/><rect width={e.width} height={e.depth} fill={selected?'#ddd4ff':'#d9e8ec'} stroke={selected?selectedColor:'#7e9ea5'} strokeWidth={.025}/><line x1={.04} y1={e.depth/2} x2={e.width-.04} y2={e.depth/2} stroke={selected?selectedColor:'#76919b'} strokeWidth={.018}/></>
      :e.kind==='door'?<><rect x={-.02} y={-.025} width={e.width+.04} height={e.depth+.05} fill="#f9f8f5"/><path d={`M0,${e.depth/2} L0,${e.width+e.depth/2} M${e.width},${e.depth/2} A${e.width},${e.width} 0 0 1 0,${e.width+e.depth/2}`} fill="none" stroke={selected?selectedColor:'#b7997e'} strokeWidth={selected?.045:.025}/><rect x={-.015} y={e.depth/2} width={.045} height={e.width} fill={selected?selectedColor:'#c7a98d'}/></>
      :e.kind==='room'?<><rect x={.035} y={.035} width={Math.max(.05,e.width-.07)} height={Math.max(.05,e.depth-.07)} fill={selected?'#ebe5ff':'#eeece7'} fillOpacity={selected?.75:.48} stroke={selected?selectedColor:'none'} strokeWidth={.035}/><text x={e.width/2} y={e.depth/2-.07} textAnchor="middle" fontSize={Math.min(.22,e.width/9)} fill={selected?selectedColor:'#747582'} letterSpacing=".008em">{e.name}</text><text x={e.width/2} y={e.depth/2+.25} textAnchor="middle" fontSize={.17} fill="#a0a0a9">{(e.width*e.depth*(units==='ft'?10.7639104:1)).toFixed(1)} {units==='ft'?'ft²':'m²'}</text></>
      :e.kind==='stair'?<><rect width={e.width} height={e.depth} fill={selected?'#e9e3fd':'#f0ebe4'} stroke={stroke} strokeWidth={.025}/>{Array.from({length:stepCount},(_,i)=><line key={i} x1={0} y1={e.depth*(i+1)/stepCount} x2={e.width} y2={e.depth*(i+1)/stepCount} stroke={selected?selectedColor:'#b2aba3'} strokeWidth={.018}/>)}<path d={`M${e.width/2},${e.depth-.2} V.2 l-.12 .2 m.12 -.2 l.12 .2`} fill="none" stroke={stroke} strokeWidth={.025}/></>
      :<rect width={e.width} height={e.depth} fill={selected?'#eae4ff':e.kind==='slab'?'#faf9f6':e.kind==='roof'?'#e3e0d7':'#e8ebee'} fillOpacity={e.kind==='roof'?.3:.85} stroke={stroke} strokeDasharray={e.kind==='reference'?'.1 .1':undefined} strokeWidth={selected?.055:.018}/>
    }
  </g>;
}

function Projection({project,viewMode,selectedIds,onSelect,showGrid}:{project:Project;viewMode:ViewMode;selectedIds:string[];onSelect:(ids:string[])=>void;showGrid:boolean}) {
  const drawing=createProjectionDrawing(project,viewMode==='section'?'section':'elevation',showGrid);
  const bounds=drawing.bounds,width=Math.max(1,bounds.maxX-bounds.minX),height=Math.max(1,bounds.maxY-bounds.minY),padding=Math.max(width,height)*.12;
  const groups:{elementId?:string;primitives:DrawingPrimitive[]}[]=[];
  for(const primitive of drawing.primitives){const last=groups[groups.length-1];if(last&&last.elementId===primitive.elementId)last.primitives.push(primitive);else groups.push({elementId:primitive.elementId,primitives:[primitive]});}
  function activate(id:string,additive=false){onSelect(additive?(selectedIds.includes(id)?selectedIds.filter(existing=>existing!==id):[...selectedIds,id]):[id]);}
  return <svg viewBox={`${bounds.minX-padding} ${bounds.minY-padding} ${width+padding*2} ${height+padding*2}`} aria-label={drawing.title} className="projection-svg" onClick={()=>onSelect([])}>
    <desc>{drawing.subtitle}</desc>
    {drawing.empty?<text x={(bounds.minX+bounds.maxX)/2} y={(bounds.minY+bounds.maxY)/2} textAnchor="middle" fontSize=".4" fill="#9995a5">No model geometry to project</text>:groups.map((group,i)=>{
      const selected=!!group.elementId&&selectedIds.includes(group.elementId),element=group.elementId?project.elements.find(e=>e.id===group.elementId):undefined;
      return <g key={`${group.elementId??'annotation'}-${i}`} role={group.elementId?'button':undefined} tabIndex={group.elementId?0:undefined} aria-label={element?.name} aria-pressed={group.elementId?selected:undefined} onKeyDown={event=>{if(group.elementId&&(event.key==='Enter'||event.key===' ')){event.preventDefault();activate(group.elementId,event.ctrlKey||event.metaKey||event.shiftKey);}}} onClick={event=>{if(group.elementId){event.stopPropagation();activate(group.elementId,event.ctrlKey||event.metaKey||event.shiftKey);}}} style={{cursor:group.elementId?'pointer':'default'}}>
        {element&&<title>{element.name}</title>}
        {group.primitives.map((primitive,j)=>primitive.kind==='text'?<text key={j} x={primitive.points[0]?.x} y={primitive.points[0]?.y} fill={primitive.stroke} fontSize={primitive.fontSize??.2} textAnchor={primitive.anchor??'middle'} style={{pointerEvents:'none'}}>{primitive.text}</text>:primitive.kind==='polygon'?<polygon key={j} points={primitive.points.map(p=>`${p.x},${p.y}`).join(' ')} fill={selected&&primitive.fill!=='none'?'#e2dafa':primitive.fill??'none'} stroke={selected?selectedColor:primitive.stroke} strokeWidth={selected?.045:primitive.width??.02} strokeDasharray={primitive.dashed?'.1 .07':undefined}/>:<polyline key={j} points={primitive.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={selected?selectedColor:primitive.stroke} strokeWidth={selected?.035:primitive.width??.02} strokeDasharray={primitive.dashed?'.1 .07':undefined} style={{pointerEvents:group.elementId?'stroke':'none'}}/>)}
      </g>;
    })}
    {!drawing.empty&&<text x={bounds.minX} y={bounds.maxY+padding*.65} fontSize=".15" fill="#9b96a5" style={{pointerEvents:'none'}}>{drawing.subtitle}</text>}
  </svg>;
}

export default function PlanEditor(props:ModelViewportProps) {
  const {project,selectedIds,onSelect,activeLevelId,tool,onCreate,onUpdate,showGrid,fitKey,viewMode}=props;
  const svgRef=useRef<SVGSVGElement>(null);
  const [drawing,setDrawing]=useState<Drawing|null>(null),[dragging,setDragging]=useState<Dragging|null>(null),[notice,setNotice]=useState('');
  const [zoom,setZoom]=useState(1),[pan,setPan]=useState<Point2>({x:0,y:0});
  const panStart=useRef<{client:Point2;pan:Point2}|null>(null);
  const annotations=useMemo(()=>createPlanAnnotations(project,activeLevelId),[project,activeLevelId]);
  const buildingBounds=useMemo(()=>modelBounds(project.elements),[project.elements]);
  const bounds=useMemo(()=>{if(!annotations.length)return buildingBounds;const notes=drawingBounds(annotations);return{...buildingBounds,minX:Math.min(buildingBounds.minX,notes.minX),minY:Math.min(buildingBounds.minY,notes.minY),maxX:Math.max(buildingBounds.maxX,notes.maxX),maxY:Math.max(buildingBounds.maxY,notes.maxY)};},[buildingBounds,annotations]);
  const baseWidth=Math.max(8,bounds.maxX-bounds.minX+4),baseHeight=Math.max(7,bounds.maxY-bounds.minY+4);
  const viewWidth=baseWidth/zoom,viewHeight=baseHeight/zoom;
  const viewX=(bounds.minX+bounds.maxX)/2-viewWidth/2+pan.x,viewY=(bounds.minY+bounds.maxY)/2-viewHeight/2+pan.y;
  const visible=project.elements.filter(e=>e.levelId===activeLevelId).sort((a,b)=>layerOrder[a.kind]-layerOrder[b.kind]);
  const gridId=`plan-grid-${project.id.replace(/[^a-zA-Z0-9]/g,'')}`;
  useEffect(()=>{setZoom(1);setPan({x:0,y:0});},[fitKey,project.id]);
  useEffect(()=>{setDrawing(null);setDragging(null);setNotice('');},[tool,activeLevelId,viewMode]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setDrawing(null);setDragging(null);setNotice('');} };
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[]);
  function point(event:{clientX:number;clientY:number},doSnap=true):Point2 {
    const svg=svgRef.current;if(!svg)return{x:0,y:0};
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const ctm=svg.getScreenCTM();if(!ctm)return{x:0,y:0};
    const transformed=p.matrixTransform(ctm.inverse());
    return{x:doSnap?snap(transformed.x):transformed.x,y:doSnap?snap(transformed.y):transformed.y};
  }
  function begin(event:ReactPointerEvent<SVGSVGElement>) {
    if(event.button===1||event.button===2){panStart.current={client:{x:event.clientX,y:event.clientY},pan};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();return;}
    if(tool==='select'){onSelect([]);return;}
    const p=point(event);setDrawing({start:p,end:p});setNotice('');event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:ReactPointerEvent<SVGSVGElement>) {
    if(panStart.current){const box=svgRef.current?.getBoundingClientRect();if(box)setPan({x:panStart.current.pan.x-(event.clientX-panStart.current.client.x)*viewWidth/box.width,y:panStart.current.pan.y-(event.clientY-panStart.current.client.y)*viewHeight/box.height});return;}
    const p=point(event);
    if(drawing)setDrawing({...drawing,end:p});
    if(dragging)setDragging({...dragging,delta:{x:p.x-dragging.start.x,y:p.y-dragging.start.y}});
  }
  function finish(event:ReactPointerEvent<SVGSVGElement>) {
    if(panStart.current){panStart.current=null;return;}
    if(dragging){const {id,original,delta}=dragging;if(Math.abs(delta.x)+Math.abs(delta.y)>.01)onUpdate(id,{x:original.x+delta.x,y:original.y+delta.y});setDragging(null);return;}
    if(!drawing)return;
    const p=point(event),kind=tool as BimElement['kind'];
    const result=createDrawnElement(project,kind,drawing.start,p,activeLevelId);
    if(result.element){onCreate(result.element);onSelect([result.element.id]);}else setNotice(result.error??'Unable to create this element.');
    setDrawing(null);
  }
  function select(event:ReactPointerEvent<SVGGElement>,e:BimElement){
    if(tool!=='select')return;
    event.stopPropagation();
    const additive=event.ctrlKey||event.metaKey||event.shiftKey;
    onSelect(additive?(selectedIds.includes(e.id)?selectedIds.filter(id=>id!==e.id):[...selectedIds,e.id]):[e.id]);
    if(e.editable&&!additive){setDragging({id:e.id,start:point(event),original:e,delta:{x:0,y:0}});svgRef.current?.setPointerCapture(event.pointerId);}
  }
  function wheel(event:ReactWheelEvent<SVGSVGElement>){if(event.ctrlKey||event.metaKey)event.preventDefault();setZoom(z=>Math.min(5,Math.max(.35,z*(event.deltaY>0?.9:1.1))));}
  const drawingWidth=drawing?Math.abs(drawing.end.x-drawing.start.x):0,drawingDepth=drawing?Math.abs(drawing.end.y-drawing.start.y):0;
  const modeName=project.levels.find(l=>l.id===activeLevelId)?.name??'Building';
  if(viewMode==='section'||viewMode==='elevation')return <div className="plan-editor model-projection"><Projection {...{project,viewMode,selectedIds,onSelect,showGrid}}/><div className="viewport-view-name">{viewMode==='section'?'Section A–A':'South elevation'}<span>ORTHOGRAPHIC</span></div></div>;
  return <div className="plan-editor" style={{position:'relative',width:'100%',height:'100%',minHeight:350,overflow:'hidden',background:'#f9f8f5'}}>
    <svg ref={svgRef} className="plan-svg" width="100%" height="100%" viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{setDrawing(null);setDragging(null);panStart.current=null;}} onWheel={wheel} onContextMenu={e=>e.preventDefault()} style={{display:'block',touchAction:'none',cursor:tool==='select'?'default':'crosshair',userSelect:'none'}} aria-label={`${modeName} editable floor plan`}>
      <defs><pattern id={gridId} x="0" y="0" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e7e5e1" strokeWidth=".012"/></pattern><pattern id={`${gridId}-dots`} x="0" y="0" width=".25" height=".25" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".009" fill="#dedcd7"/></pattern></defs>
      {showGrid&&<><rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill={`url(#${gridId}-dots)`}/><rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill={`url(#${gridId})`}/></>}
      {showGrid&&project.grids.map(grid=><g key={grid.id}><line x1={grid.axis==='x'?grid.value:bounds.minX-1} x2={grid.axis==='x'?grid.value:bounds.maxX+1} y1={grid.axis==='y'?grid.value:bounds.minY-1} y2={grid.axis==='y'?grid.value:bounds.maxY+1} stroke="#bdc4ce" strokeDasharray=".12 .09" strokeWidth=".012"/><circle cx={grid.axis==='x'?grid.value:bounds.minX-1} cy={grid.axis==='y'?grid.value:bounds.minY-1} r=".18" fill="#f9f8f5" stroke="#aeb5c1" strokeWidth=".015"/><text x={grid.axis==='x'?grid.value:bounds.minX-1} y={(grid.axis==='y'?grid.value:bounds.minY-1)+.065} textAnchor="middle" fontSize=".17" fill="#8c94a1">{grid.label}</text></g>)}
      {!!visible.length&&<g aria-label="Overall plan dimensions" stroke="#aeabb6" strokeWidth=".013" fill="#9895a3"><line x1={buildingBounds.minX} x2={buildingBounds.maxX} y1={buildingBounds.minY-.55} y2={buildingBounds.minY-.55}/><path d={`M${buildingBounds.minX},${buildingBounds.minY-.65} v.2 M${buildingBounds.maxX},${buildingBounds.minY-.65} v.2`}/><text x={(buildingBounds.minX+buildingBounds.maxX)/2} y={buildingBounds.minY-.66} textAnchor="middle" fontSize=".17" stroke="none">{formatDistance(buildingBounds.maxX-buildingBounds.minX,project.units)}</text><line x1={buildingBounds.minX-.55} x2={buildingBounds.minX-.55} y1={buildingBounds.minY} y2={buildingBounds.maxY}/><path d={`M${buildingBounds.minX-.65},${buildingBounds.minY} h.2 M${buildingBounds.minX-.65},${buildingBounds.maxY} h.2`}/><text transform={`translate(${buildingBounds.minX-.67} ${(buildingBounds.minY+buildingBounds.maxY)/2}) rotate(-90)`} textAnchor="middle" fontSize=".17" stroke="none">{formatDistance(buildingBounds.maxY-buildingBounds.minY,project.units)}</text></g>}
      {visible.map(element=>{const e=dragging&&(element.id===dragging.id||element.hostId===dragging.id)?{...element,x:element.x+dragging.delta.x,y:element.y+dragging.delta.y}:element;return <PlanElement key={e.id} element={e} selected={selectedIds.includes(e.id)} onPointerDown={event=>select(event,element)} onActivate={()=>onSelect([e.id])} units={project.units}/>;})}
      <g aria-label="Drawing annotations" style={{pointerEvents:'none'}}>{annotations.map((annotation,i)=><text key={`${annotation.elementId}-${i}`} x={annotation.points[0]?.x} y={annotation.points[0]?.y} fill={annotation.stroke} fontSize={annotation.fontSize} textAnchor={annotation.anchor??'middle'} data-element-id={annotation.elementId}>{annotation.text}</text>)}</g>
      {drawing&&tool==='wall'&&<><line x1={drawing.start.x} y1={drawing.start.y} x2={drawing.end.x} y2={drawing.end.y} stroke={selectedColor} strokeWidth={.2} opacity={.65}/><text x={(drawing.start.x+drawing.end.x)/2} y={(drawing.start.y+drawing.end.y)/2-.3} fill={selectedColor} fontSize=".2" textAnchor="middle">{formatDistance(Math.hypot(drawingWidth,drawingDepth),project.units)}</text></>}
      {drawing&&!['wall','door','window'].includes(tool)&&<><rect x={Math.min(drawing.start.x,drawing.end.x)} y={Math.min(drawing.start.y,drawing.end.y)} width={drawingWidth} height={drawingDepth} fill="#b6a9ff" fillOpacity=".22" stroke={selectedColor} strokeWidth=".035" strokeDasharray=".1 .06"/><text x={(drawing.start.x+drawing.end.x)/2} y={(drawing.start.y+drawing.end.y)/2} fontSize=".2" textAnchor="middle" fill={selectedColor}>{formatDistance(drawingWidth,project.units)} × {formatDistance(drawingDepth,project.units)}</text></>}
      <g transform={`translate(${bounds.minX} ${bounds.maxY+1})`}><line x1="0" y1="0" x2="2" y2="0" stroke="#888995" strokeWidth=".025"/><path d="M0,-.06 V.06 M1,-.06 V.06 M2,-.06 V.06" stroke="#888995" strokeWidth=".025"/><text x="0" y=".3" fontSize=".14" fill="#92919b">0</text><text x="2" y=".3" textAnchor="end" fontSize=".14" fill="#92919b">2 m</text></g>
    </svg>
    <div className="viewport-view-name">{modeName}<span>FLOOR PLAN · 0.25 M SNAP</span></div>
    <div className="viewport-north" aria-label="North"><Compass size={25} strokeWidth={1.2}/><span>N</span></div>
    <div className="viewport-nav"><button title="Zoom in" aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(5,z*1.2))}><Plus size={16}/></button><button title="Zoom out" aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(.35,z/1.2))}><Minus size={16}/></button><button title="Fit plan" aria-label="Fit plan" onClick={()=>{setZoom(1);setPan({x:0,y:0});}}><Scan size={16}/></button></div>
    {(notice||tool!=='select')&&<div className={`viewport-tool-hint ${notice?'has-warning':''}`} role="status">{notice||(['door','window'].includes(tool)?`Click a wall to place a ${tool}`:`Drag to draw ${tool==='wall'?'a wall':`a ${tool}`} · Escape to cancel`)}</div>}
    {!visible.length&&tool==='select'&&<div className="viewport-empty"><span>Your next idea starts here</span><p>Choose a drawing tool to start building on this level.</p></div>}
  </div>;
}
