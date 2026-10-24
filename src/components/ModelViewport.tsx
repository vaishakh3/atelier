import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Edges, Grid, Line, OrbitControls } from '@react-three/drei';
import { Compass, Eye, Focus, Minus, Plus, Scan } from 'lucide-react';
import * as THREE from 'three';
import type { BimElement } from '../domain/types';
import { cameraFitDistance, createDrawnElement, localToWorld, modelBounds, radians, wallSegments, formatDistance } from '../model/geometry';
import type { Point2 } from '../model/geometry';
import PlanEditor, {visibleViewportElements,viewportTextEntry} from './PlanEditor';
import type { ModelViewportProps } from './PlanEditor';
export type { ModelViewportProps } from './PlanEditor';
import ViewControls from './ViewControls';
import SiteGeometry from '../site/SiteGeometry';
import {checkedViewState,facadeView,measureDistance,savedViewIssues,snapViewPoint,sectionContainsPoint,siteViewVertices,viewportWorldBounds} from '../model/viewState';
import type {CameraSnapshot,NavigationAction,PlanSnapshot,SavedModelView,SectionBox,ViewVector} from '../model/viewState';

const purple='#7661e9';
const safeSize=(n:number)=>Math.max(.008,n);
function Box({position,size,color,selected=false,opacity=1,outline=true,metalness=0,roughness=.85}:{position:[number,number,number];size:[number,number,number];color:string;selected?:boolean;opacity?:number;outline?:boolean;metalness?:number;roughness?:number}) {
  return <mesh position={position} castShadow={opacity>.7} receiveShadow>
    <boxGeometry args={size.map(safeSize) as [number,number,number]}/>
    <meshStandardMaterial color={selected?'#c9bdf3':color} transparent={opacity<1} opacity={opacity} roughness={roughness} metalness={metalness} depthWrite={opacity>.65}/>
    {outline&&<Edges threshold={28} color={selected?purple:opacity<.6?'#aaa6b2':'#89847c'} lineWidth={selected?1.7:.6} transparent opacity={Math.min(1,opacity+.15)}/>}
  </mesh>;
}

function BuildingElement({element:e,all,selected,ghost,onSelect}:{element:BimElement;all:BimElement[];selected:boolean;ghost:boolean;onSelect:(event:ThreeEvent<PointerEvent>,e:BimElement)=>void}) {
  const opacity=selected?1:ghost?.25:1;
  const onClick=(event:ThreeEvent<PointerEvent>)=>onSelect(event,e);
  const materialColor=/brick/i.test(e.material)?'#bba28e':/concrete/i.test(e.material)?'#d4d0c7':/timber|wood|oak/i.test(e.material)?'#c5ad89':'#e9e5da';
  const roomIndex=Math.max(0,all.filter(el=>el.kind==='room').findIndex(el=>el.id===e.id));
  const roomColors=['#e9e0ce','#dce4d7','#e3e4df','#e8d9ce','#dce2e8','#e9e4d3'];
  const polygonShape=useMemo(()=>{if(!e.footprint?.length)return null;const shape=new THREE.Shape();shape.moveTo(e.footprint[0].x,-e.footprint[0].y);for(const point of e.footprint.slice(1))shape.lineTo(point.x,-point.y);shape.closePath();return shape;},[e.footprint]);
  const stepCount=Math.round(Math.min(32,Math.max(4,Number(e.properties.steps)||16)));
  const position:[number,number,number]=[e.x,e.z,e.y];
  if(e.kind==='roof'&&e.properties.hiddenIn3d===true&&!selected)return null;
  if(polygonShape)return <group position={position} rotation={[0,-radians(e.rotation),0]} onClick={onClick}><mesh rotation={[-Math.PI/2,0,0]} castShadow receiveShadow><extrudeGeometry args={[polygonShape,{depth:e.kind==='room'?.02:Math.max(.008,e.height),bevelEnabled:false}]}/><meshStandardMaterial color={selected?'#c9bdf3':e.kind==='room'?roomColors[roomIndex%roomColors.length]:materialColor} transparent opacity={opacity} side={THREE.DoubleSide}/><Edges color={selected?purple:'#89847c'}/></mesh></group>;
  return <group position={position} rotation={[0,-radians(e.rotation),0]} onClick={onClick} onPointerOver={event=>{event.stopPropagation();document.body.style.cursor='pointer';}} onPointerOut={()=>{document.body.style.cursor='auto';}}>
    {e.kind==='wall'&&wallSegments(e,all).map((part,i)=><Box key={i} position={[part.x+part.width/2,part.bottom+part.height/2,e.depth/2]} size={[part.width,part.height,e.depth]} color={materialColor} selected={selected} opacity={opacity}/>)}
    {e.kind==='slab'&&<Box position={[e.width/2,e.height/2,e.depth/2]} size={[e.width,e.height,e.depth]} color={materialColor==='#d4d0c7'?'#d3c8b4':materialColor} selected={selected} opacity={opacity}/>}
    {e.kind==='roof'&&<Box position={[e.width/2,e.height/2,e.depth/2]} size={[e.width,e.height,e.depth]} color="#c5c1b5" selected={selected} opacity={opacity}/>}
    {e.kind==='room'&&<Box position={[e.width/2,.018,e.depth/2]} size={[Math.max(.1,e.width-.02),.012,Math.max(.1,e.depth-.02)]} color={roomColors[roomIndex%roomColors.length]} selected={selected} opacity={ghost?.1:.85} outline={selected}/>}
    {e.kind==='window'&&<>
      <Box position={[e.width/2,e.height/2,e.depth/2]} size={[Math.max(.02,e.width-.08),Math.max(.02,e.height-.08),.025]} color="#bad8de" selected={selected} opacity={opacity*.43} outline={false} roughness={.12} metalness={.18}/>
      {[[.035,e.height/2,.07,e.height],[e.width-.035,e.height/2,.07,e.height],[e.width/2,.035,e.width,.07],[e.width/2,e.height-.035,e.width,.07],[e.width/2,e.height/2,.04,e.height]].map(([x,y,w,h],i)=><Box key={i} position={[x,y,e.depth/2]} size={[w,h,.07]} color="#bbb7ac" selected={selected} opacity={opacity} outline={false}/>)}
      <Box position={[e.width/2,-.025,e.depth/2]} size={[e.width+.1,.05,e.depth+.15]} color="#d8d3c7" selected={selected} opacity={opacity}/>
    </>}
    {e.kind==='door'&&<>
      <group position={[.035,0,e.depth/2]} rotation={[0,-.48,0]}><Box position={[(e.width-.07)/2,e.height/2,0]} size={[e.width-.07,e.height-.035,.045]} color="#bda17d" selected={selected} opacity={opacity}/><Box position={[Math.max(.03,e.width-.16),e.height*.48,.037]} size={[.085,.025,.025]} color="#7b7c7a" selected={selected} opacity={opacity} outline={false} metalness={.7}/></group>
      {[[.025,e.height/2,.05,e.height],[e.width-.025,e.height/2,.05,e.height],[e.width/2,e.height-.025,e.width,.05]].map(([x,y,w,h],i)=><Box key={i} position={[x,y,e.depth/2]} size={[w,h,e.depth+.025]} color="#d6c5ad" selected={selected} opacity={opacity} outline={false}/>)}
    </>}
    {e.kind==='stair'&&Array.from({length:stepCount},(_,i)=>{
      const step=e.depth/stepCount,h=e.height*(i+1)/stepCount;
      return <Box key={i} position={[e.width/2,h/2,step*(i+.5)]} size={[e.width,h,step]} color="#d2c2a8" selected={selected} opacity={opacity}/>;
    })}
    {e.kind==='reference'&&<Box position={[e.width/2,e.height/2,e.depth/2]} size={[e.width,e.height,e.depth]} color="#bbc3c9" selected={selected} opacity={selected?.8:.35}/>}
  </group>;
}

/** Exact axis-aligned presets; model XY maps to Three XZ, with north at negative Z. */
export function viewportCameraFrame(elements:BimElement[],view:string,aspect:number,fov=36,context:ViewVector[]=[]){
 const bounds=viewportWorldBounds(elements,context),minimumZ=bounds.minZ;
 const target=new THREE.Vector3((bounds.minX+bounds.maxX)/2,(minimumZ+bounds.maxZ)/2,(bounds.minY+bounds.maxY)/2);
 const radius=Math.max(.25,Math.hypot(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,bounds.maxZ-minimumZ)/2);
 const distance=Math.max(.5,cameraFitDistance(radius,fov,Math.max(.01,aspect)));
 const direction=(view==='top'||view==='north')?new THREE.Vector3(0,1,0):view==='front'?new THREE.Vector3(0,0,1):new THREE.Vector3(1.03,.88,1.14).normalize();
 return{target,position:target.clone().add(direction.multiplyScalar(distance)),up:view==='top'?new THREE.Vector3(0,0,-1):new THREE.Vector3(0,1,0),radius,distance};
}
export function FitCamera({props,controlsRef,view,selectionKey}:{props:ModelViewportProps;controlsRef:React.RefObject<any>;view:string;selectionKey:number}) {
 const {camera,invalidate,size}=useThree();
 const previous=useRef<{all:number;selection:number;view:string;project:string;visibility:string}|null>(null),scope=useRef<'all'|'selection'>('all');
 const visibility=JSON.stringify([props.hiddenIds,props.isolatedIds]);
 useEffect(()=>{
  const last=previous.current;
  if(selectionKey>0&&(!last||last.selection!==selectionKey))scope.current='selection';
  else if(!last||last.visibility!==visibility||last.all!==props.fitKey||last.view!==view||last.project!==props.project.id)scope.current='all';
  previous.current={all:props.fitKey,selection:selectionKey,view,project:props.project.id,visibility};
  const rendered=visibleViewportElements(props.project,props.hiddenIds,props.isolatedIds),selected=rendered.filter(element=>props.selectedIds.includes(element.id));
  const frame=viewportCameraFrame(scope.current==='selection'&&selected.length?selected:rendered,view,size.width/Math.max(1,size.height),(camera as THREE.PerspectiveCamera).fov||36,scope.current==='selection'&&selected.length?[]:siteViewVertices(props.project));
  camera.up.copy(frame.up);if(view==='north'){const north=(props.project.planning?.northAngle??props.project.site?.trueNorthAngle??0)*Math.PI/180;camera.up.set(-Math.sin(north),0,Math.cos(north));}camera.position.copy(frame.position);camera.lookAt(frame.target);
  camera.far=Math.max(2000,frame.distance+frame.radius*4);camera.updateProjectionMatrix();
  if(controlsRef.current){controlsRef.current.target.copy(frame.target);controlsRef.current.update();}
  invalidate();
 },[props.fitKey,selectionKey,props.project.id,camera,controlsRef,invalidate,view,size.width,size.height,visibility,props.project.site]);
 useEffect(()=>{const saved=props.viewRestore?.view;if(saved?.viewMode==='3d'&&saved.camera){camera.position.fromArray(saved.camera.position);camera.up.fromArray(saved.camera.up);if(controlsRef.current){controlsRef.current.target.fromArray(saved.camera.target);controlsRef.current.update();}camera.lookAt(new THREE.Vector3(...saved.camera.target));camera.updateProjectionMatrix();invalidate();}},[props.viewRestore?.key,camera,controlsRef,invalidate,props.project.id]);
 return null;
}

/** Six planes clip real geometry; no model elements or estimate quantities are removed. */
export function sectionClippingPlanes(box:SectionBox){return box.enabled?[new THREE.Plane(new THREE.Vector3(1,0,0),-box.min.x),new THREE.Plane(new THREE.Vector3(-1,0,0),box.max.x),new THREE.Plane(new THREE.Vector3(0,0,1),-box.min.y),new THREE.Plane(new THREE.Vector3(0,0,-1),box.max.y),new THREE.Plane(new THREE.Vector3(0,1,0),-box.min.z),new THREE.Plane(new THREE.Vector3(0,-1,0),box.max.z)]:[];}
function SceneClipping({box}:{box:SectionBox}){const {gl,invalidate}=useThree();useEffect(()=>{gl.clippingPlanes=sectionClippingPlanes(box);invalidate();return()=>{gl.clippingPlanes=[];invalidate();};},[gl,invalidate,JSON.stringify(box)]);return null;}
export function CameraTools({props,controlsRef,command,onCapture}:{props:ModelViewportProps;controlsRef:React.RefObject<any>;command:{id:number;action:NavigationAction;point?:ViewVector}|null;onCapture:(snapshot:{camera?:CameraSnapshot;plan?:PlanSnapshot})=>void}){
 const {camera,gl,invalidate}=useThree();
 const emit=useCallback(()=>{if(controlsRef.current)onCapture({camera:{position:camera.position.toArray() as [number,number,number],target:controlsRef.current.target.toArray(),up:camera.up.toArray() as [number,number,number]}});},[camera,controlsRef,onCapture]);
 useEffect(()=>{const control=controlsRef.current;control?.addEventListener('change',emit);emit();return()=>control?.removeEventListener('change',emit);},[controlsRef,emit]);
 useEffect(()=>{if(!command||!controlsRef.current)return;const target=controlsRef.current.target as THREE.Vector3;
  if(command.action==='align'){const facade=facadeView(props.project,props.selectedIds);if(!facade)return;const d=Math.max(4,camera.position.distanceTo(target));target.fromArray(facade.target);camera.up.set(0,1,0);camera.position.copy(target).add(new THREE.Vector3(...facade.normal).multiplyScalar(d));}
  if(command.action==='north'){const frame=viewportCameraFrame(visibleViewportElements(props.project,props.hiddenIds,props.isolatedIds),'top',1,36,siteViewVertices(props.project));const north=(props.project.planning?.northAngle??props.project.site?.trueNorthAngle??0)*Math.PI/180;target.copy(frame.target);camera.position.copy(frame.position);camera.up.set(-Math.sin(north),0,Math.cos(north));}
  if(command.action==='look-from'&&command.point){const direction=target.clone().sub(camera.position).normalize(),distance=Math.max(2,camera.position.distanceTo(target));camera.position.set(command.point.x,command.point.z+.05,command.point.y);target.copy(camera.position).add(direction.multiplyScalar(distance));camera.up.set(0,1,0);}
  camera.lookAt(target);camera.updateProjectionMatrix();controlsRef.current.update();emit();invalidate();
 },[command?.id,camera,controlsRef,emit,invalidate,props.viewMode]);
 // Ctrl/right swivels the view from a fixed eye; Shift/right remains OrbitControls pan.
 useEffect(()=>{const canvas=gl.domElement;let drag:{x:number;y:number;yaw:number;pitch:number;distance:number;eye:THREE.Vector3;damping:boolean}|null=null;
  const down=(event:PointerEvent)=>{if(event.button!==2||!(event.ctrlKey||event.metaKey)||event.shiftKey)return;event.preventDefault();event.stopImmediatePropagation();const direction=(controlsRef.current?.target as THREE.Vector3)?.clone().sub(camera.position);if(!direction)return;const distance=direction.length(),eye=camera.position.clone(),target=controlsRef.current.target.clone(),damping=controlsRef.current.enableDamping;controlsRef.current.enableDamping=false;controlsRef.current.update();camera.position.copy(eye);controlsRef.current.target.copy(target);controlsRef.current.update();direction.normalize();drag={x:event.clientX,y:event.clientY,yaw:Math.atan2(direction.x,direction.z),pitch:Math.asin(Math.max(-1,Math.min(1,direction.y))),distance,eye,damping};if(controlsRef.current)controlsRef.current.enabled=false;};
  const move=(event:PointerEvent)=>{if(!drag)return;event.preventDefault();const yaw=drag.yaw-(event.clientX-drag.x)*.006,pitch=Math.max(-1.55,Math.min(1.55,drag.pitch+(event.clientY-drag.y)*.006)),direction=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));camera.position.copy(drag.eye);const target=drag.eye.clone().add(direction.multiplyScalar(drag.distance));controlsRef.current?.target.copy(target);camera.up.set(0,1,0);camera.lookAt(target);emit();invalidate();};
  const up=()=>{if(!drag)return;const damping=drag.damping;drag=null;if(controlsRef.current){controlsRef.current.enabled=props.tool==='select';controlsRef.current.update();controlsRef.current.enableDamping=damping;}emit();};
  const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape')up();};
  canvas.addEventListener('pointerdown',down,true);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('keydown',cancel);
  return()=>{canvas.removeEventListener('pointerdown',down,true);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('keydown',cancel);};
 },[camera,gl,controlsRef,emit,invalidate,props.tool]);
 return null;
}

function DrawingPlane({props,onNotice}:{props:ModelViewportProps;onNotice:(text:string)=>void}) {
  const [draft,setDraft]=useState<{start:Point2;end:Point2}|null>(null);
  const level=props.project.levels.find(l=>l.id===props.activeLevelId)??props.project.levels[0];
  useEffect(()=>setDraft(null),[props.tool,props.activeLevelId]);
  useEffect(()=>{const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!viewportTextEntry(event.target))setDraft(null);};window.addEventListener('keydown',cancel);return()=>window.removeEventListener('keydown',cancel);},[]);
  if(props.tool==='select'||!level)return null;
  const snapping=checkedViewState(props.project).snapping;
  function point(event:ThreeEvent<PointerEvent>):Point2{return snapViewPoint({...props.project,elements:visibleViewportElements(props.project,props.hiddenIds,props.isolatedIds)},{x:event.point.x,y:event.point.z},snapping,{levelId:props.activeLevelId,origin:draft?.start}).point;}
  function finish(event:ThreeEvent<PointerEvent>){
    if(event.button!==0)return;event.stopPropagation();if(!draft)return;
    const result=createDrawnElement(props.project,props.tool as BimElement['kind'],draft.start,point(event),props.activeLevelId,{snapStep:snapping.enabled&&snapping.grid?snapping.step:null});
    if(result.element){props.onCreate(result.element);props.onSelect([result.element.id]);onNotice('');}else onNotice(result.error??'Unable to create this element.');
    setDraft(null);
  }
  const left=draft?Math.min(draft.start.x,draft.end.x):0,top=draft?Math.min(draft.start.y,draft.end.y):0;
  const dx=draft?draft.end.x-draft.start.x:0,dy=draft?draft.end.y-draft.start.y:0;
  return <>
    <mesh position={[0,level.elevation+.24,0]} rotation={[-Math.PI/2,0,0]} onPointerDown={event=>{if(event.button!==0)return;event.stopPropagation();setDraft({start:point(event),end:point(event)});(event.target as unknown as {setPointerCapture:(id:number)=>void}).setPointerCapture(event.pointerId);}} onPointerMove={event=>{event.stopPropagation();if(draft)setDraft({...draft,end:point(event)});}} onPointerUp={finish}>
      <planeGeometry args={[500,500]}/><meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false}/>
    </mesh>
    {draft&&props.tool==='wall'&&<group position={[draft.start.x,level.elevation+.35,draft.start.y]} rotation={[0,-Math.atan2(dy,dx),0]}><Box position={[Math.hypot(dx,dy)/2,1.45,.1]} size={[Math.max(.01,Math.hypot(dx,dy)),2.9,.2]} color={purple} opacity={.45}/></group>}
    {draft&&!['wall','door','window'].includes(props.tool)&&<Box position={[left+Math.abs(dx)/2,level.elevation+.28,top+Math.abs(dy)/2]} size={[Math.max(.01,Math.abs(dx)),.045,Math.max(.01,Math.abs(dy))]} color={purple} opacity={.5}/>}
  </>;
}

class ViewportBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return{failed:true};}
  componentDidCatch(error:Error,info:ErrorInfo){console.warn('3D view unavailable; editable plan remains available.',error.message,info.componentStack);}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}

export default function ModelViewport(props:ModelViewportProps) {
  const controlsRef=useRef<any>(null),commandCounter=useRef(0),snapshot=useRef<{camera?:CameraSnapshot;plan?:PlanSnapshot}>({});
  const [restore,setRestore]=useState<{key:number;view:SavedModelView}|undefined>(),[action,setAction]=useState<NavigationAction|null>(null),[points,setPoints]=useState<ViewVector[]>([]),[measurement,setMeasurement]=useState(''),[cameraCommand,setCameraCommand]=useState<{id:number;action:NavigationAction;point?:ViewVector}|null>(null),[openKey,setOpenKey]=useState(0);
  const capture=useCallback((next:{camera?:CameraSnapshot;plan?:PlanSnapshot})=>{snapshot.current=next;},[]);
  const [view,setView]=useState('perspective'),[localFit,setLocalFit]=useState(0),[localSelectionFit,setLocalSelectionFit]=useState(0),[notice,setNotice]=useState('');
  const [webgl]=useState(()=>{try{const canvas=document.createElement('canvas');return !!(canvas.getContext('webgl2')||canvas.getContext('webgl'));}catch{return false;}});
  const levelElevation=props.project.levels.find(l=>l.id===props.activeLevelId)?.elevation??0;
  const rendered=useMemo(()=>visibleViewportElements(props.project,props.hiddenIds,props.isolatedIds),[props.project,props.hiddenIds,props.isolatedIds]);
  const siteVertices=useMemo(()=>siteViewVertices(props.project),[props.project.site]);
  const bounds=useMemo(()=>viewportWorldBounds(rendered,siteVertices),[rendered,siteVertices]);
  const settings=checkedViewState(props.project);
  const activeProps={...props,fitKey:props.fitKey+localFit,viewRestore:restore};
  function runAction(next:NavigationAction){setNotice('');if(next==='section-box'){setOpenKey(key=>key+1);return;}if(next==='measure'||next==='look-from'){if(next==='look-from'&&props.viewMode!=='3d')return;setAction(current=>current===next?null:next);setPoints([]);setMeasurement('');props.onCancelInteraction?.();return;}if(next==='align'){if(!facadeView(props.project,props.selectedIds)){setNotice('Select a wall or hosted opening to align its facade.');return;}props.onViewContextChange?.({viewMode:'3d',levelId:props.activeLevelId,hiddenIds:props.hiddenIds??[],isolatedIds:props.isolatedIds??[],contextHiddenIds:props.contextHiddenIds??[]});setView('perspective');}if(next==='north')setView('north');setCameraCommand({id:++commandCounter.current,action:next});}
  useEffect(()=>{setAction(null);setPoints([]);setMeasurement('');setRestore(undefined);},[props.project.id]);
  useEffect(()=>{if(props.navigationRequest)runAction(props.navigationRequest.action);},[props.navigationRequest?.id]);
  function pick(point:ViewVector){if(action==='look-from'){setCameraCommand({id:++commandCounter.current,action:'look-from',point});setView('perspective');setAction(null);return;}if(action==='measure'){setPoints(previous=>{const next=previous.length>=2?[point]:[...previous,point];if(next.length===2)setMeasurement(`${formatDistance(measureDistance(next[0],next[1]),props.project.units)} · world distance`);else setMeasurement('First point placed');return next;});}}
  function restoreSaved(saved:SavedModelView){const issues=savedViewIssues(props.project,saved);if(issues.length){setNotice(issues.join(' '));return;}setRestore({key:++commandCounter.current,view:saved});props.onViewContextChange?.({viewMode:saved.viewMode,levelId:saved.levelId,hiddenIds:saved.hiddenIds,isolatedIds:saved.isolatedIds,contextHiddenIds:saved.contextHiddenIds??[]});setView('custom');setAction(null);setCameraCommand(null);}
  const viewControls=<ViewControls project={props.project} viewMode={props.viewMode} selectedIds={props.selectedIds} levelId={props.activeLevelId} hiddenIds={props.hiddenIds??[]} isolatedIds={props.isolatedIds??[]} contextHiddenIds={props.contextHiddenIds??[]} state={settings} canEdit={props.canEditViewState??false} onChange={props.onViewStateChange} capture={()=>snapshot.current} onRestore={restoreSaved} onAction={runAction} activeAction={action} measurement={measurement} openKey={openKey}/>;
  const planProps={...props,viewRestore:restore,precisionAction:action,onPrecisionPoint:pick,onViewportSnapshot:capture,onCancelInteraction:()=>{setAction(null);setPoints([]);setMeasurement('');props.onCancelInteraction?.();},navigationRequest:cameraCommand??props.navigationRequest};
  useEffect(()=>{setNotice('');document.body.style.cursor='auto';return()=>{document.body.style.cursor='auto';};},[props.tool,props.viewMode]);
  useEffect(()=>{if(props.viewMode!=='3d'||!webgl)return;const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!viewportTextEntry(event.target)){props.onSelect([]);props.onCancelInteraction?.();setNotice('');setAction(null);setPoints([]);setMeasurement('');}};window.addEventListener('keydown',cancel);return()=>window.removeEventListener('keydown',cancel);},[props.viewMode,webgl,props.onSelect,props.onCancelInteraction]);
  if(props.viewMode!=='3d')return <div style={{position:'relative',height:'100%',width:'100%'}}><PlanEditor {...planProps}/>{viewControls}</div>;
  const fallback=<div className="model-viewport" style={{height:'100%',position:'relative'}}><PlanEditor {...planProps} viewMode="plan"/>{viewControls}<div className="viewport-webgl-note" role="status">3D rendering is unavailable in this browser. The editable floor plan is available.</div></div>;
  if(!webgl)return fallback;
  function select(event:ThreeEvent<PointerEvent>,element:BimElement){
    if(!sectionContainsPoint(settings.sectionBox,{x:event.point.x,y:event.point.z,z:event.point.y}))return;event.stopPropagation();if(event.button!==0)return;if(action){pick({x:event.point.x,y:event.point.z,z:event.point.y});return;}if(props.tool!=='select')return;
    const additive=event.ctrlKey||event.metaKey||event.shiftKey;
    props.onSelect(additive?(props.selectedIds.includes(element.id)?props.selectedIds.filter(id=>id!==element.id):[...props.selectedIds,element.id]):[element.id]);
  }
  return <div className="model-viewport" style={{position:'relative',width:'100%',height:'100%',minHeight:350,background:'#f0f1f3'}}>
    <ViewportBoundary fallback={fallback}>
      <Canvas shadows dpr={[1,1.8]} camera={{position:[19,16,21],fov:36,near:.05,far:2000}} gl={{antialias:true,alpha:false}} onPointerMissed={event=>{if(props.tool==='select'&&event.button===0)props.onSelect([]);}} aria-label="Interactive 3D building model" style={{cursor:props.tool==='select'?'default':'crosshair'}}>
        <SceneClipping box={settings.sectionBox}/><color attach="background" args={['#f0f1f3']}/><fog attach="fog" args={['#f0f1f3',Math.max(65,Math.hypot(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,bounds.maxZ)*1.5),Math.max(180,Math.hypot(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,bounds.maxZ)*6)]}/>
        <ambientLight intensity={.85}/><hemisphereLight args={['#ffffff','#b4a68d',.9]}/>
        <directionalLight position={[12,22,8]} intensity={1.9} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-22} shadow-bias={-.0004} shadow-normalBias={.05}/>
        <directionalLight position={[-8,8,-12]} intensity={.6}/>
        <Suspense fallback={null}>
          <SiteGeometry site={props.project.site}/>
          {rendered.map(element=><BuildingElement key={element.id} element={element} all={props.project.elements} selected={props.selectedIds.includes(element.id)} ghost={props.ghostUpper&&element.z>levelElevation+.6} onSelect={select}/>)}
          <mesh onClick={event=>{if(action){event.stopPropagation();pick({x:event.point.x,y:event.point.z,z:event.point.y});}}} rotation={[-Math.PI/2,0,0]} position={[(bounds.minX+bounds.maxX)/2,-.035,(bounds.minY+bounds.maxY)/2]} receiveShadow><planeGeometry args={[500,500]}/><meshStandardMaterial color="#efefed" roughness={1}/></mesh>
          {props.showGrid&&<Grid position={[0,-.023,0]} args={[100,100]} cellSize={settings.snapping.step} sectionSize={Math.max(5,settings.snapping.step*5)} cellThickness={.55} sectionThickness={.8} cellColor="#d7d7d8" sectionColor="#c8c9ce" fadeDistance={45} fadeStrength={1.4} infiniteGrid/>}
          <DrawingPlane props={action?{...props,tool:'select'}:props} onNotice={setNotice}/>
          {points.length===2&&<Line points={points.map(point=>[point.x,point.z,point.y])} color="#8b65b1" lineWidth={2}/> }
        </Suspense>
        <OrbitControls key={view} ref={controlsRef} makeDefault minPolarAngle={0} maxPolarAngle={Math.PI} minDistance={.3} maxDistance={Math.max(150,Math.hypot(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,bounds.maxZ)*12)} mouseButtons={{LEFT:undefined,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.ROTATE}} enableRotate={view==='perspective'||view==='custom'} enableDamping dampingFactor={.09} enabled={props.tool==='select'} zoomToCursor/>
        <FitCamera props={activeProps} controlsRef={controlsRef} view={view} selectionKey={(props.fitSelectionKey??0)+localSelectionFit}/>
        <CameraTools props={props} controlsRef={controlsRef} command={cameraCommand} onCapture={capture}/>
      </Canvas>
    </ViewportBoundary>
    <div className="viewport-view-name">{view==='top'?'Top view':view==='front'?'South view':view==='north'?'True north / model north':view==='custom'?'Saved camera':'Perspective'}<span>{props.ghostUpper?'BUILDING CUTAWAY':'3D MODEL'}</span></div>
<button className="viewport-north" aria-label="Align true north" title="Align entered true north; model north when unset" onClick={()=>runAction('north')}><Compass size={28} strokeWidth={1.1}/><span>{props.project.planning?.northAngle!=null||props.project.site?'TN':'N'}</span></button>
    {viewControls}
    <div className="viewport-orbit-hint"><span className="mouse-glyph"/>{view==='perspective'?'Right drag to orbit · Shift + right drag to pan':'Middle or Shift + right drag to pan'}<span>·</span>Scroll to zoom</div>
    <div className="viewport-nav" role="group" aria-label="View navigation"><button title="Zoom in" aria-label="Zoom in" onClick={()=>{controlsRef.current?.dollyIn(.8);controlsRef.current?.update();}}><Plus size={16}/></button><button title="Zoom out" aria-label="Zoom out" onClick={()=>{controlsRef.current?.dollyOut(.8);controlsRef.current?.update();}}><Minus size={16}/></button><button title="Perspective view" aria-label="Perspective view" className={view==='perspective'?'active':''} onClick={()=>{setView('perspective');setLocalFit(v=>v+1);}}><Eye size={16}/></button><button title="Top view" aria-label="Top view" className={view==='top'?'active':''} onClick={()=>{setView('top');setLocalFit(v=>v+1);}}><span style={{fontSize:11,fontWeight:650}}>TOP</span></button><button title="South view" aria-label="South view" className={view==='front'?'active':''} onClick={()=>{setView('front');setLocalFit(v=>v+1);}}><span style={{fontSize:11,fontWeight:650}}>S</span></button><button title="Fit all" aria-label="Fit all" onClick={()=>setLocalFit(v=>v+1)}><Scan size={16}/></button><button title="Fit selection · F" aria-label="Fit selection" disabled={!rendered.some(element=>props.selectedIds.includes(element.id))} onClick={()=>setLocalSelectionFit(value=>value+1)}><Focus size={16}/></button></div>
    {(notice||props.tool!=='select')&&<div className={`viewport-tool-hint ${notice?'has-warning':''}`} role="status">{notice||(['door','window'].includes(props.tool)?`Click a wall location to place a ${props.tool}`:`Drag on the active level to draw a ${props.tool} · Plan view offers precise placement`)}</div>}
    {!rendered.length&&!siteVertices.length&&<div className="viewport-empty"><span>{props.project.elements.length?'No visible geometry':'A place for your next idea'}</span><p>{props.project.elements.length?'Show all elements to restore the model view.':'Draw on the active level or import an IFC model to begin.'}</p></div>}
  </div>;
}
