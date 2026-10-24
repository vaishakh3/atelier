import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { Compass, Focus, Minus, Plus, Scan } from 'lucide-react';
import type { BimElement, Project, ViewMode } from '../domain/types';
import { createDrawnElement, formatDistance, modelBounds } from '../model/geometry';
import type { Point2 } from '../model/geometry';
import { createPlanAnnotations, createProjectionDrawing, drawingBounds } from '../model/drawings';
import type { DrawingPrimitive } from '../model/drawings';
import {checkedViewState,snapViewPoint,sectionIntersectsElement,siteViewVertices,viewportWorldBounds} from '../model/viewState';
import type {CameraSnapshot,NavigationAction,PlanSnapshot,ProjectViewState,SavedModelView,ViewContext,ViewVector} from '../model/viewState';
import {polygonArea} from '../model/polygon';
import SitePlanGeometry from '../site/SitePlanGeometry';

export interface ModelViewportProps {
  project:Project; selectedIds:string[]; onSelect:(ids:string[])=>void; viewMode:ViewMode;
  activeLevelId:string; tool:string; onCreate:(element:BimElement)=>void;
  onUpdate:(id:string,patch:Partial<BimElement>)=>void; showGrid:boolean; ghostUpper:boolean; fitKey:number; fitSelectionKey?:number; onCancelInteraction?:()=>void; hiddenIds?:string[]; isolatedIds?:string[];contextHiddenIds?:string[];
  onViewStateChange?:(state:ProjectViewState)=>void;canEditViewState?:boolean;onViewContextChange?:(context:ViewContext)=>void;navigationRequest?:{id:number;action:NavigationAction};
  viewRestore?:{key:number;view:SavedModelView};precisionAction?:NavigationAction|null;onPrecisionPoint?:(point:ViewVector)=>void;onViewportSnapshot?:(snapshot:{camera?:CameraSnapshot;plan?:PlanSnapshot})=>void;
}
/** Transient visibility only. Hosts retain geometric context; canonical project data is untouched. */
export function visibleViewportElements(project:Project,hiddenIds:string[]=[],isolatedIds:string[]=[]):BimElement[]{
 const hidden=new Set(hiddenIds),isolated=new Set(isolatedIds),byId=new Map(project.elements.map(element=>[element.id,element]));
 const hiddenByHost=(element:BimElement,seen=new Set<string>()):boolean=>{if(hidden.has(element.id))return true;if(!element.hostId||seen.has(element.id))return false;const host=byId.get(element.hostId);return !!host&&hiddenByHost(host,new Set([...seen,element.id]));};
 const context=new Set(isolated);
 for(const id of isolated){const element=byId.get(id);if(element?.hostId)context.add(element.hostId);if(element?.kind==='wall')for(const child of project.elements)if(child.hostId===id)context.add(child.id);}
 return project.elements.filter(element=>!hiddenByHost(element)&&(!isolated.size||context.has(element.id)));
}
type ViewBounds={minX:number;minY:number;maxX:number;maxY:number};
const clampZoom=(value:number)=>Math.min(80,Math.max(.05,value));
export const viewportTextEntry=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]');
/** Camera state only: focusing or navigating never edits the model. */
function useViewportFrame(bounds:ViewBounds,selection:ViewBounds|null,fitKey:number,fitSelectionKey:number|undefined,identity:string,restore?:{key:number;view:SavedModelView},onSnapshot?:ModelViewportProps['onViewportSnapshot']){
 const [rotation,setRotation]=useState(0);
 const [zoom,setZoom]=useState(1),[pan,setPan]=useState<Point2>({x:0,y:0});
 const selectionRequest=useRef<number|undefined>(undefined);
 const dimensions=(angle:number)=>{const a=angle*Math.PI/180,dx=bounds.maxX-bounds.minX,dy=bounds.maxY-bounds.minY;return{width:Math.max(8,Math.abs(Math.cos(a))*dx+Math.abs(Math.sin(a))*dy+4),height:Math.max(7,Math.abs(Math.sin(a))*dx+Math.abs(Math.cos(a))*dy+4)};};
 const extent=dimensions(rotation),baseWidth=extent.width,baseHeight=extent.height;
 const centre={x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2};
 const fitAll=()=>{setZoom(1);setPan({x:0,y:0});};
 const fitSelection=()=>{if(!selection)return;const dx=selection.maxX-selection.minX,dy=selection.maxY-selection.minY,a=rotation*Math.PI/180,padding=Math.max(.3,Math.max(dx,dy)*.15),width=Math.abs(Math.cos(a))*dx+Math.abs(Math.sin(a))*dy,height=Math.abs(Math.sin(a))*dx+Math.abs(Math.cos(a))*dy;setZoom(clampZoom(Math.min(baseWidth/Math.max(.5,width+padding*2),baseHeight/Math.max(.5,height+padding*2))));setPan({x:(selection.minX+selection.maxX)/2-centre.x,y:(selection.minY+selection.maxY)/2-centre.y});};
 useEffect(fitAll,[fitKey,identity]);
 useEffect(()=>{if(selectionRequest.current!==fitSelectionKey){selectionRequest.current=fitSelectionKey;if((fitSelectionKey??0)>0)fitSelection();}},[fitSelectionKey]);
 useEffect(()=>{if(restore?.view.plan){const rect=restore.view.plan,nextRotation=rect.rotation??0,next=dimensions(nextRotation);setRotation(nextRotation);setZoom(clampZoom(Math.min(next.width/rect.width,next.height/rect.height)));setPan({x:rect.x+rect.width/2-centre.x,y:rect.y+rect.height/2-centre.y});}},[restore?.key,restore?.view.levelId]);
 const width=baseWidth/zoom,height=baseHeight/zoom,x=centre.x-width/2+pan.x,y=centre.y-height/2+pan.y;
 const zoomBy=(factor:number,anchor?:Point2)=>{const next=clampZoom(zoom*factor);if(anchor){const ratio=zoom/next;setPan({x:anchor.x-(anchor.x-centre.x-pan.x)*ratio-centre.x,y:anchor.y-(anchor.y-centre.y-pan.y)*ratio-centre.y});}setZoom(next);};
 useEffect(()=>{onSnapshot?.({plan:{x,y,width,height,rotation}});},[x,y,width,height,rotation,onSnapshot]);
 return{zoom,pan,setPan,zoomBy,fitAll,fitSelection,width,height,x,y,rotation,setRotation};
}
function ViewNavigation({zoomBy,fitAll,fitSelection,hasSelection}:{zoomBy:(factor:number)=>void;fitAll:()=>void;fitSelection:()=>void;hasSelection:boolean}){
 return <div className="viewport-nav" role="group" aria-label="View navigation"><button title="Zoom in" aria-label="Zoom in" onClick={()=>zoomBy(1.2)}><Plus size={16}/></button><button title="Zoom out" aria-label="Zoom out" onClick={()=>zoomBy(1/1.2)}><Minus size={16}/></button><button title="Fit all" aria-label="Fit all" onClick={fitAll}><Scan size={16}/></button><button title="Fit selection · F" aria-label="Fit selection" disabled={!hasSelection} onClick={fitSelection}><Focus size={16}/></button></div>;
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
    {e.footprint?.length?<><polygon points={e.footprint.map(point=>`${point.x},${point.y}`).join(' ')} fill={selected?'#e7dff9':e.kind==='room'?'#eeece7':'#d9d3c8'} fillOpacity={e.kind==='room'?.55:.8} stroke={stroke} strokeWidth={selected?.055:.025}/><text x={e.width/2} y={e.depth/2} textAnchor="middle" fontSize=".2" fill={stroke}>{e.name}</text>{e.kind==='room'&&<text x={e.width/2} y={e.depth/2+.3} textAnchor="middle" fontSize=".16" fill={stroke}>{(polygonArea(e.footprint)*(units==='ft'?10.7639104:1)).toFixed(1)} {units==='ft'?'ft²':'m²'}</text>}</>:e.kind==='wall'?<><rect width={e.width} height={e.depth} fill={selected?'#9584f1':'#57596a'} stroke={selected?selectedColor:'#414453'} strokeWidth={selected?.065:.025}/>{selected&&<><line x1={0} y1={-.32} x2={e.width} y2={-.32} stroke={selectedColor} strokeWidth={.018}/><path d={`M0,-.43 v.22 M${e.width},-.43 v.22`} stroke={selectedColor} strokeWidth={.018}/><text x={e.width/2} y={-.42} textAnchor="middle" fill={selectedColor} fontSize={.18}>{formatDistance(e.width,units)}</text></>}</>
      :e.kind==='window'?<><rect x={-.015} y={-.025} width={e.width+.03} height={e.depth+.05} fill="#f8fafc"/><rect width={e.width} height={e.depth} fill={selected?'#ddd4ff':'#d9e8ec'} stroke={selected?selectedColor:'#7e9ea5'} strokeWidth={.025}/><line x1={.04} y1={e.depth/2} x2={e.width-.04} y2={e.depth/2} stroke={selected?selectedColor:'#76919b'} strokeWidth={.018}/></>
      :e.kind==='door'?<><rect x={-.02} y={-.025} width={e.width+.04} height={e.depth+.05} fill="#f9f8f5"/><path d={`M0,${e.depth/2} L0,${e.width+e.depth/2} M${e.width},${e.depth/2} A${e.width},${e.width} 0 0 1 0,${e.width+e.depth/2}`} fill="none" stroke={selected?selectedColor:'#b7997e'} strokeWidth={selected?.045:.025}/><rect x={-.015} y={e.depth/2} width={.045} height={e.width} fill={selected?selectedColor:'#c7a98d'}/></>
      :e.kind==='room'?<><rect x={.035} y={.035} width={Math.max(.05,e.width-.07)} height={Math.max(.05,e.depth-.07)} fill={selected?'#ebe5ff':'#eeece7'} fillOpacity={selected?.75:.48} stroke={selected?selectedColor:'none'} strokeWidth={.035}/><text x={e.width/2} y={e.depth/2-.07} textAnchor="middle" fontSize={Math.min(.22,e.width/9)} fill={selected?selectedColor:'#747582'} letterSpacing=".008em">{e.name}</text><text x={e.width/2} y={e.depth/2+.25} textAnchor="middle" fontSize={.17} fill="#a0a0a9">{(e.width*e.depth*(units==='ft'?10.7639104:1)).toFixed(1)} {units==='ft'?'ft²':'m²'}</text></>
      :e.kind==='stair'?<><rect width={e.width} height={e.depth} fill={selected?'#e9e3fd':'#f0ebe4'} stroke={stroke} strokeWidth={.025}/>{Array.from({length:stepCount},(_,i)=><line key={i} x1={0} y1={e.depth*(i+1)/stepCount} x2={e.width} y2={e.depth*(i+1)/stepCount} stroke={selected?selectedColor:'#b2aba3'} strokeWidth={.018}/>)}<path d={`M${e.width/2},${e.depth-.2} V.2 l-.12 .2 m.12 -.2 l.12 .2`} fill="none" stroke={stroke} strokeWidth={.025}/></>
      :<rect width={e.width} height={e.depth} fill={selected?'#eae4ff':e.kind==='slab'?'#faf9f6':e.kind==='roof'?'#e3e0d7':'#e8ebee'} fillOpacity={e.kind==='roof'?.3:.85} stroke={stroke} strokeDasharray={e.kind==='reference'?'.1 .1':undefined} strokeWidth={selected?.055:.018}/>
    }
  </g>;
}

function Projection({project,viewMode,selectedIds,onSelect,showGrid,fitKey,fitSelectionKey,visibilityKey,viewRestore,onViewportSnapshot,sectionBox}:{project:Project;viewMode:ViewMode;selectedIds:string[];onSelect:(ids:string[])=>void;showGrid:boolean;fitKey:number;fitSelectionKey?:number;visibilityKey?:string;viewRestore?:ModelViewportProps['viewRestore'];onViewportSnapshot?:ModelViewportProps['onViewportSnapshot'];sectionBox:ProjectViewState['sectionBox']}) {
  const drawing=createProjectionDrawing(project,viewMode==='section'?'section':'elevation',showGrid);
  const bounds=drawing.bounds,padding=Math.max(1,bounds.maxX-bounds.minX,bounds.maxY-bounds.minY)*.12;
  const selectedPrimitives=drawing.primitives.filter(primitive=>primitive.elementId&&selectedIds.includes(primitive.elementId));
  const frame=useViewportFrame(bounds,selectedPrimitives.length?drawingBounds(selectedPrimitives):null,fitKey,fitSelectionKey,`${project.id}:${viewMode}:${visibilityKey??''}`,viewRestore,onViewportSnapshot);
  const panStart=useRef<{x:number;y:number;pan:Point2}|null>(null);
  const svgRef=useRef<SVGSVGElement>(null);
  useEffect(()=>{const svg=svgRef.current,prevent=(event:WheelEvent)=>event.preventDefault(),cancel=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!viewportTextEntry(event.target))panStart.current=null;};svg?.addEventListener('wheel',prevent,{passive:false});window.addEventListener('keydown',cancel);return()=>{svg?.removeEventListener('wheel',prevent);window.removeEventListener('keydown',cancel);};},[]);
  const groups:{elementId?:string;primitives:DrawingPrimitive[]}[]=[];
  for(const primitive of drawing.primitives){const last=groups[groups.length-1];if(last&&last.elementId===primitive.elementId)last.primitives.push(primitive);else groups.push({elementId:primitive.elementId,primitives:[primitive]});}
  function activate(id:string,additive=false){onSelect(additive?(selectedIds.includes(id)?selectedIds.filter(existing=>existing!==id):[...selectedIds,id]):[id]);}
  return <><svg ref={svgRef} viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`} aria-label={drawing.title} className="projection-svg" onClick={event=>{if(event.button===0)onSelect([]);}} onContextMenu={event=>event.preventDefault()} onWheel={event=>frame.zoomBy(event.deltaY>0?.9:1.1)} onPointerDown={event=>{if(event.button===1||event.button===2){panStart.current={x:event.clientX,y:event.clientY,pan:frame.pan};event.currentTarget.setPointerCapture?.(event.pointerId);event.preventDefault();}}} onPointerMove={event=>{const start=panStart.current,rect=event.currentTarget.getBoundingClientRect();if(start&&rect.width&&rect.height)frame.setPan({x:start.pan.x-(event.clientX-start.x)*frame.width/rect.width,y:start.pan.y-(event.clientY-start.y)*frame.height/rect.height});}} onPointerUp={()=>{panStart.current=null;}} onPointerCancel={()=>{panStart.current=null;}} style={{touchAction:'none'}}>
    <desc>{drawing.subtitle}</desc><defs><clipPath id={`projection-cut-${project.id}`}><rect x={sectionBox.min.x} y={-sectionBox.max.z} width={sectionBox.max.x-sectionBox.min.x} height={sectionBox.max.z-sectionBox.min.z}/></clipPath></defs><g clipPath={sectionBox.enabled?`url(#projection-cut-${project.id})`:undefined}>
    {drawing.empty?<text x={(bounds.minX+bounds.maxX)/2} y={(bounds.minY+bounds.maxY)/2} textAnchor="middle" fontSize=".4" fill="#9995a5">No model geometry to project</text>:groups.map((group,i)=>{
      const selected=!!group.elementId&&selectedIds.includes(group.elementId),element=group.elementId?project.elements.find(e=>e.id===group.elementId):undefined;
      return <g key={`${group.elementId??'annotation'}-${i}`} role={group.elementId?'button':undefined} tabIndex={group.elementId?0:undefined} aria-label={element?.name} aria-pressed={group.elementId?selected:undefined} onKeyDown={event=>{if(group.elementId&&(event.key==='Enter'||event.key===' ')){event.preventDefault();activate(group.elementId,event.ctrlKey||event.metaKey||event.shiftKey);}}} onClick={event=>{if(group.elementId&&event.button===0){event.stopPropagation();activate(group.elementId,event.ctrlKey||event.metaKey||event.shiftKey);}}} style={{cursor:group.elementId?'pointer':'default'}}>
        {element&&<title>{element.name}</title>}
        {group.primitives.map((primitive,j)=>primitive.kind==='text'?<text key={j} x={primitive.points[0]?.x} y={primitive.points[0]?.y} fill={primitive.stroke} fontSize={primitive.fontSize??.2} textAnchor={primitive.anchor??'middle'} style={{pointerEvents:'none'}}>{primitive.text}</text>:primitive.kind==='polygon'?<polygon key={j} points={primitive.points.map(p=>`${p.x},${p.y}`).join(' ')} fill={selected&&primitive.fill!=='none'?'#e2dafa':primitive.fill??'none'} stroke={selected?selectedColor:primitive.stroke} strokeWidth={selected?.045:primitive.width??.02} strokeDasharray={primitive.dashed?'.1 .07':undefined}/>:<polyline key={j} points={primitive.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={selected?selectedColor:primitive.stroke} strokeWidth={selected?.035:primitive.width??.02} strokeDasharray={primitive.dashed?'.1 .07':undefined} style={{pointerEvents:group.elementId?'stroke':'none'}}/>)}
      </g>;
    })}
    {!drawing.empty&&<text x={bounds.minX} y={bounds.maxY+padding*.65} fontSize=".15" fill="#9b96a5" style={{pointerEvents:'none'}}>{drawing.subtitle}</text>}
  </g></svg><ViewNavigation zoomBy={frame.zoomBy} fitAll={frame.fitAll} fitSelection={frame.fitSelection} hasSelection={selectedPrimitives.length>0}/><div className="viewport-orbit-hint">Middle or right drag to pan · Scroll to zoom</div></>;
}

export default function PlanEditor(props:ModelViewportProps) {
  const {project,selectedIds,onSelect,activeLevelId,tool,onCreate,onUpdate,showGrid,fitKey,viewMode}=props;
  const svgRef=useRef<SVGSVGElement>(null);
  const [drawing,setDrawing]=useState<Drawing|null>(null),[dragging,setDragging]=useState<Dragging|null>(null),[notice,setNotice]=useState('');
  const panStart=useRef<{client:Point2;pan:Point2}|null>(null);
  const settings=checkedViewState(project),section=settings.sectionBox;
  const rendered=useMemo(()=>visibleViewportElements(project,props.hiddenIds,props.isolatedIds).filter(element=>sectionIntersectsElement(section,element)),[project,props.hiddenIds,props.isolatedIds,JSON.stringify(section)]);
  const displayProject=useMemo(()=>({...project,elements:rendered}),[project,rendered]);
  const annotations=useMemo(()=>createPlanAnnotations(displayProject,activeLevelId),[displayProject,activeLevelId]);
  const levelElements=useMemo(()=>rendered.filter(element=>element.levelId===activeLevelId),[rendered,activeLevelId]);
  const buildingBounds=useMemo(()=>modelBounds(levelElements),[levelElements]);
  const siteVertices=useMemo(()=>siteViewVertices(project),[project.site]);
  const sceneBounds=useMemo(()=>viewportWorldBounds(levelElements,siteVertices),[levelElements,siteVertices]);
  const bounds=useMemo(()=>{if(!annotations.length)return sceneBounds;const notes=drawingBounds(annotations);return{...sceneBounds,minX:Math.min(sceneBounds.minX,notes.minX),minY:Math.min(sceneBounds.minY,notes.minY),maxX:Math.max(sceneBounds.maxX,notes.maxX),maxY:Math.max(sceneBounds.maxY,notes.maxY)};},[sceneBounds,annotations]);
  const selection=levelElements.filter(element=>selectedIds.includes(element.id));
  const frame=useViewportFrame(bounds,selection.length?modelBounds(selection):null,fitKey,props.fitSelectionKey,`${project.id}:${activeLevelId}:${viewMode}:${JSON.stringify([props.hiddenIds,props.isolatedIds])}`,props.viewRestore?.view.viewMode===viewMode&&props.viewRestore.view.levelId===activeLevelId?props.viewRestore:undefined,props.onViewportSnapshot);
  const {width:viewWidth,height:viewHeight,x:viewX,y:viewY,pan,setPan}=frame;
  const visible=[...levelElements].sort((a,b)=>layerOrder[a.kind]-layerOrder[b.kind]);
  const [snapGuides,setSnapGuides]=useState<{axis:'x'|'y';value:number}[]>([]);
  useEffect(()=>{if(props.navigationRequest?.action==='north'){const north=project.planning?.northAngle??project.site?.trueNorthAngle??0;frame.setRotation(((180-north+540)%360)-180);}},[props.navigationRequest?.id]);
  const gridId=`plan-grid-${project.id.replace(/[^a-zA-Z0-9]/g,'')}`;
  useEffect(()=>{setDrawing(null);setDragging(null);setSnapGuides([]);setNotice('');},[tool,activeLevelId,viewMode]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!viewportTextEntry(e.target)){setDrawing(null);setDragging(null);panStart.current=null;setSnapGuides([]);setNotice('');onSelect([]);props.onCancelInteraction?.();} };
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[onSelect,props.onCancelInteraction]);
  useEffect(()=>{const svg=svgRef.current,prevent=(event:WheelEvent)=>event.preventDefault();svg?.addEventListener('wheel',prevent,{passive:false});return()=>svg?.removeEventListener('wheel',prevent);},[viewMode]);
  function point(event:{clientX:number;clientY:number},doSnap=true):Point2 {
    const svg=svgRef.current;if(!svg)return{x:0,y:0};
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const ctm=svg.getScreenCTM();if(!ctm)return{x:0,y:0};
    const transformed=p.matrixTransform(ctm.inverse()),a=-frame.rotation*Math.PI/180,cx=viewX+viewWidth/2,cy=viewY+viewHeight/2,dx=transformed.x-cx,dy=transformed.y-cy,raw=frame.rotation===0?{x:transformed.x,y:transformed.y}:{x:cx+dx*Math.cos(a)-dy*Math.sin(a),y:cy+dx*Math.sin(a)+dy*Math.cos(a)};
    return doSnap?snapViewPoint(displayProject,raw,settings.snapping,{levelId:activeLevelId,origin:drawing?.start,excludeIds:dragging?[dragging.id]:[],tolerance:viewWidth/100}).point:raw;
  }
  function begin(event:ReactPointerEvent<SVGSVGElement>) {
    if(event.button===1||event.button===2){panStart.current={client:{x:event.clientX,y:event.clientY},pan};event.currentTarget.setPointerCapture?.(event.pointerId);event.preventDefault();return;}
    if(event.button!==0)return;
    if(props.precisionAction){const raw=point(event);props.onPrecisionPoint?.({...raw,z:project.levels.find(level=>level.id===activeLevelId)?.elevation??0});return;}
    if(tool==='select'){onSelect([]);return;}
    const p=point(event);setDrawing({start:p,end:p});setNotice('');event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event:ReactPointerEvent<SVGSVGElement>) {
    if(panStart.current){const box=svgRef.current?.getBoundingClientRect();if(box?.width&&box.height){const dx=(event.clientX-panStart.current.client.x)*viewWidth/box.width,dy=(event.clientY-panStart.current.client.y)*viewHeight/box.height,a=-frame.rotation*Math.PI/180;setPan({x:panStart.current.pan.x-dx*Math.cos(a)+dy*Math.sin(a),y:panStart.current.pan.y-dx*Math.sin(a)-dy*Math.cos(a)});}return;}
    const p=point(event);
    if(settings.snapping.enabled&&(settings.snapping.objects||settings.snapping.axes)){const guides=snapViewPoint(displayProject,point(event,false),settings.snapping,{levelId:activeLevelId,origin:drawing?.start,excludeIds:dragging?[dragging.id]:[],tolerance:viewWidth/100}).guides;setSnapGuides(guides);}
    if(drawing)setDrawing({...drawing,end:p});
    if(dragging)setDragging({...dragging,delta:{x:p.x-dragging.start.x,y:p.y-dragging.start.y}});
  }
  function finish(event:ReactPointerEvent<SVGSVGElement>) {
    if(panStart.current){panStart.current=null;return;}
    if(event.button!==0)return;
    if(dragging){const {id,original,delta}=dragging;if(Math.abs(delta.x)+Math.abs(delta.y)>.01)onUpdate(id,{x:original.x+delta.x,y:original.y+delta.y});setDragging(null);return;}
    if(!drawing)return;
    const p=point(event),kind=tool as BimElement['kind'];
    const result=createDrawnElement(project,kind,drawing.start,p,activeLevelId,{snapStep:settings.snapping.enabled&&settings.snapping.grid?settings.snapping.step:null});
    if(result.element){onCreate(result.element);onSelect([result.element.id]);}else setNotice(result.error??'Unable to create this element.');
    setDrawing(null);
  }
  function select(event:ReactPointerEvent<SVGGElement>,e:BimElement){
    if(tool!=='select'||event.button!==0)return;
    event.stopPropagation();
    if(props.precisionAction){const p=point(event);props.onPrecisionPoint?.({...p,z:project.levels.find(level=>level.id===activeLevelId)?.elevation??0});return;}
    const additive=event.ctrlKey||event.metaKey||event.shiftKey;
    onSelect(additive?(selectedIds.includes(e.id)?selectedIds.filter(id=>id!==e.id):[...selectedIds,e.id]):[e.id]);
    if(e.editable&&!additive){setDragging({id:e.id,start:point(event),original:e,delta:{x:0,y:0}});svgRef.current?.setPointerCapture?.(event.pointerId);}
  }
  function wheel(event:ReactWheelEvent<SVGSVGElement>){frame.zoomBy(event.deltaY>0?.9:1.1,point(event,false));}
  const drawingWidth=drawing?Math.abs(drawing.end.x-drawing.start.x):0,drawingDepth=drawing?Math.abs(drawing.end.y-drawing.start.y):0;
  const modeName=project.levels.find(l=>l.id===activeLevelId)?.name??'Building';
  if(viewMode==='section'||viewMode==='elevation')return <div className="plan-editor model-projection"><Projection {...{viewMode,selectedIds,onSelect,showGrid,fitKey}} project={displayProject} fitSelectionKey={props.fitSelectionKey} visibilityKey={JSON.stringify([props.hiddenIds,props.isolatedIds])} viewRestore={props.viewRestore?.view.viewMode===viewMode?props.viewRestore:undefined} onViewportSnapshot={props.onViewportSnapshot} sectionBox={section}/><div className="viewport-view-name">{viewMode==='section'?'Section A–A':'South elevation'}<span>ORTHOGRAPHIC</span></div></div>;
  return <div className="plan-editor" style={{position:'relative',width:'100%',height:'100%',minHeight:350,overflow:'hidden',background:'#f9f8f5'}}>
    <svg ref={svgRef} className="plan-svg" width="100%" height="100%" viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{setDrawing(null);setDragging(null);panStart.current=null;}} onWheel={wheel} onContextMenu={e=>e.preventDefault()} style={{display:'block',touchAction:'none',cursor:tool==='select'?'default':'crosshair',userSelect:'none'}} aria-label={`${modeName} editable floor plan`}>
      <defs><pattern id={gridId} x="0" y="0" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e7e5e1" strokeWidth=".012"/></pattern><pattern id={`${gridId}-dots`} x="0" y="0" width={settings.snapping.step} height={settings.snapping.step} patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".009" fill="#dedcd7"/></pattern></defs>
      <defs><clipPath id={`${gridId}-section`}><rect x={section.min.x} y={section.min.y} width={section.max.x-section.min.x} height={section.max.y-section.min.y}/></clipPath></defs>
      <g transform={`rotate(${frame.rotation} ${viewX+viewWidth/2} ${viewY+viewHeight/2})`}><g clipPath={section.enabled?`url(#${gridId}-section)`:undefined}>
      <SitePlanGeometry site={project.site}/>
      {showGrid&&<><rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill={`url(#${gridId}-dots)`}/><rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill={`url(#${gridId})`}/></>}
      {showGrid&&project.grids.map(grid=><g key={grid.id}><line x1={grid.axis==='x'?grid.value:bounds.minX-1} x2={grid.axis==='x'?grid.value:bounds.maxX+1} y1={grid.axis==='y'?grid.value:bounds.minY-1} y2={grid.axis==='y'?grid.value:bounds.maxY+1} stroke="#bdc4ce" strokeDasharray=".12 .09" strokeWidth=".012"/><circle cx={grid.axis==='x'?grid.value:bounds.minX-1} cy={grid.axis==='y'?grid.value:bounds.minY-1} r=".18" fill="#f9f8f5" stroke="#aeb5c1" strokeWidth=".015"/><text x={grid.axis==='x'?grid.value:bounds.minX-1} y={(grid.axis==='y'?grid.value:bounds.minY-1)+.065} textAnchor="middle" fontSize=".17" fill="#8c94a1">{grid.label}</text></g>)}
      {!!visible.length&&<g aria-label="Overall plan dimensions" stroke="#aeabb6" strokeWidth=".013" fill="#9895a3"><line x1={buildingBounds.minX} x2={buildingBounds.maxX} y1={buildingBounds.minY-.55} y2={buildingBounds.minY-.55}/><path d={`M${buildingBounds.minX},${buildingBounds.minY-.65} v.2 M${buildingBounds.maxX},${buildingBounds.minY-.65} v.2`}/><text x={(buildingBounds.minX+buildingBounds.maxX)/2} y={buildingBounds.minY-.66} textAnchor="middle" fontSize=".17" stroke="none">{formatDistance(buildingBounds.maxX-buildingBounds.minX,project.units)}</text><line x1={buildingBounds.minX-.55} x2={buildingBounds.minX-.55} y1={buildingBounds.minY} y2={buildingBounds.maxY}/><path d={`M${buildingBounds.minX-.65},${buildingBounds.minY} h.2 M${buildingBounds.minX-.65},${buildingBounds.maxY} h.2`}/><text transform={`translate(${buildingBounds.minX-.67} ${(buildingBounds.minY+buildingBounds.maxY)/2}) rotate(-90)`} textAnchor="middle" fontSize=".17" stroke="none">{formatDistance(buildingBounds.maxY-buildingBounds.minY,project.units)}</text></g>}
      {visible.map(element=>{const e=dragging&&(element.id===dragging.id||element.hostId===dragging.id)?{...element,x:element.x+dragging.delta.x,y:element.y+dragging.delta.y}:element;return <PlanElement key={e.id} element={e} selected={selectedIds.includes(e.id)} onPointerDown={event=>select(event,element)} onActivate={()=>onSelect([e.id])} units={project.units}/>;})}
      <g aria-label="Drawing annotations" style={{pointerEvents:'none'}}>{annotations.map((annotation,i)=><text key={`${annotation.elementId}-${i}`} x={annotation.points[0]?.x} y={annotation.points[0]?.y} fill={annotation.stroke} fontSize={annotation.fontSize} textAnchor={annotation.anchor??'middle'} data-element-id={annotation.elementId}>{annotation.text}</text>)}</g>
      {drawing&&tool==='wall'&&<><line x1={drawing.start.x} y1={drawing.start.y} x2={drawing.end.x} y2={drawing.end.y} stroke={selectedColor} strokeWidth={.2} opacity={.65}/><text x={(drawing.start.x+drawing.end.x)/2} y={(drawing.start.y+drawing.end.y)/2-.3} fill={selectedColor} fontSize=".2" textAnchor="middle">{formatDistance(Math.hypot(drawingWidth,drawingDepth),project.units)}</text></>}
      {drawing&&!['wall','door','window'].includes(tool)&&<><rect x={Math.min(drawing.start.x,drawing.end.x)} y={Math.min(drawing.start.y,drawing.end.y)} width={drawingWidth} height={drawingDepth} fill="#b6a9ff" fillOpacity=".22" stroke={selectedColor} strokeWidth=".035" strokeDasharray=".1 .06"/><text x={(drawing.start.x+drawing.end.x)/2} y={(drawing.start.y+drawing.end.y)/2} fontSize=".2" textAnchor="middle" fill={selectedColor}>{formatDistance(drawingWidth,project.units)} × {formatDistance(drawingDepth,project.units)}</text></>}
      <g transform={`translate(${bounds.minX} ${bounds.maxY+1})`}><line x1="0" y1="0" x2="2" y2="0" stroke="#888995" strokeWidth=".025"/><path d="M0,-.06 V.06 M1,-.06 V.06 M2,-.06 V.06" stroke="#888995" strokeWidth=".025"/><text x="0" y=".3" fontSize=".14" fill="#92919b">0</text><text x="2" y=".3" textAnchor="end" fontSize=".14" fill="#92919b">2 m</text></g>
      {snapGuides.map((guide,index)=><line key={index} x1={guide.axis==='x'?guide.value:viewX} x2={guide.axis==='x'?guide.value:viewX+viewWidth} y1={guide.axis==='y'?guide.value:viewY} y2={guide.axis==='y'?guide.value:viewY+viewHeight} stroke="#a286bf" strokeWidth=".02" strokeDasharray=".12 .08" style={{pointerEvents:'none'}}/>)}
      </g></g>
    </svg>
    <div className="viewport-view-name">{modeName}<span>FLOOR PLAN · {settings.snapping.enabled?`${settings.snapping.grid?settings.snapping.step+' M GRID':'FREE GRID'}${settings.snapping.objects?' · OBJECTS':''}${settings.snapping.axes?' · AXES':''}`:'SNAPPING OFF'}</span></div>
    <button className="viewport-north" aria-label="Align true north" title={project.planning?.northAngle===null&&!project.site?"True north unset · model north":"Align entered true north"} onClick={()=>{const north=project.planning?.northAngle??project.site?.trueNorthAngle??0;frame.setRotation(((180-north+540)%360)-180);}}><Compass size={25} strokeWidth={1.2}/><span>{project.planning?.northAngle!=null||project.site?'TN':'N'}</span></button>
    <ViewNavigation zoomBy={frame.zoomBy} fitAll={frame.fitAll} fitSelection={frame.fitSelection} hasSelection={selection.length>0}/>
    <div className="viewport-orbit-hint">Middle or right drag to pan · Scroll to zoom · Shift-click to add to selection</div>
    {(notice||tool!=='select')&&<div className={`viewport-tool-hint ${notice?'has-warning':''}`} role="status">{notice||(['door','window'].includes(tool)?`Click a wall to place a ${tool}`:`Drag to draw ${tool==='wall'?'a wall':`a ${tool}`} · Escape to cancel`)}</div>}
    {!visible.length&&!siteVertices.length&&tool==='select'&&<div className="viewport-empty"><span>{project.elements.length?'No visible elements on this level':'Your next idea starts here'}</span><p>{project.elements.length?'Show all elements or choose another level.':'Choose a drawing tool to start building on this level.'}</p></div>}
  </div>;
}
