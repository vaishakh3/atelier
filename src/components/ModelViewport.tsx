import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Edges, Grid, OrbitControls } from '@react-three/drei';
import { Compass, Eye, Scan } from 'lucide-react';
import * as THREE from 'three';
import type { BimElement } from '../domain/types';
import { cameraFitDistance, createDrawnElement, localToWorld, modelBounds, radians, snap, wallSegments } from '../model/geometry';
import type { Point2 } from '../model/geometry';
import PlanEditor from './PlanEditor';
import type { ModelViewportProps } from './PlanEditor';
export type { ModelViewportProps } from './PlanEditor';

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
  const stepCount=Math.round(Math.min(32,Math.max(4,Number(e.properties.steps)||16)));
  const position:[number,number,number]=[e.x,e.z,e.y];
  if(e.kind==='roof'&&e.properties.hiddenIn3d===true&&!selected)return null;
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

function FitCamera({props,controlsRef,view}:{props:ModelViewportProps;controlsRef:React.RefObject<any>;view:string}) {
  const {camera,invalidate,size}=useThree();
  useEffect(()=>{
    const bounds=modelBounds(props.project.elements);
    const minimumZ=Math.min(0,...props.project.elements.map(element=>element.z));
    const centre=new THREE.Vector3((bounds.minX+bounds.maxX)/2,(minimumZ+bounds.maxZ)/2,(bounds.minY+bounds.maxY)/2);
    const radius=Math.max(2,Math.hypot(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,bounds.maxZ-minimumZ)/2);
    // Fit the bounding sphere to the narrower field of view, including portrait canvases.
    const distance=Math.min(145,Math.max(4,cameraFitDistance(radius,(camera as THREE.PerspectiveCamera).fov||36,Math.max(1,size.width)/Math.max(1,size.height))));
    const direction=view==='top'?new THREE.Vector3(.001,1,.001):view==='front'?new THREE.Vector3(0,.2,1):new THREE.Vector3(1.03,.88,1.14);
    const vector=direction.normalize().multiplyScalar(distance);
    camera.position.copy(centre.clone().add(vector));camera.lookAt(centre);camera.updateProjectionMatrix();
    if(controlsRef.current){controlsRef.current.target.copy(centre);controlsRef.current.update();}
    invalidate();
  },[props.fitKey,props.project.id,camera,controlsRef,invalidate,view,size.width,size.height]);
  return null;
}

function DrawingPlane({props,onNotice}:{props:ModelViewportProps;onNotice:(text:string)=>void}) {
  const [draft,setDraft]=useState<{start:Point2;end:Point2}|null>(null);
  const level=props.project.levels.find(l=>l.id===props.activeLevelId)??props.project.levels[0];
  useEffect(()=>setDraft(null),[props.tool,props.activeLevelId]);
  if(props.tool==='select'||!level)return null;
  function point(event:ThreeEvent<PointerEvent>):Point2{return{x:snap(event.point.x),y:snap(event.point.z)};}
  function finish(event:ThreeEvent<PointerEvent>){
    event.stopPropagation();if(!draft)return;
    const result=createDrawnElement(props.project,props.tool as BimElement['kind'],draft.start,point(event),props.activeLevelId);
    if(result.element){props.onCreate(result.element);props.onSelect([result.element.id]);onNotice('');}else onNotice(result.error??'Unable to create this element.');
    setDraft(null);
  }
  const left=draft?Math.min(draft.start.x,draft.end.x):0,top=draft?Math.min(draft.start.y,draft.end.y):0;
  const dx=draft?draft.end.x-draft.start.x:0,dy=draft?draft.end.y-draft.start.y:0;
  return <>
    <mesh position={[0,level.elevation+.24,0]} rotation={[-Math.PI/2,0,0]} onPointerDown={event=>{event.stopPropagation();setDraft({start:point(event),end:point(event)});(event.target as unknown as {setPointerCapture:(id:number)=>void}).setPointerCapture(event.pointerId);}} onPointerMove={event=>{event.stopPropagation();if(draft)setDraft({...draft,end:point(event)});}} onPointerUp={finish}>
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
  const controlsRef=useRef<any>(null);
  const [view,setView]=useState('perspective'),[localFit,setLocalFit]=useState(0),[notice,setNotice]=useState('');
  const [webgl]=useState(()=>{try{const canvas=document.createElement('canvas');return !!(canvas.getContext('webgl2')||canvas.getContext('webgl'));}catch{return false;}});
  const levelElevation=props.project.levels.find(l=>l.id===props.activeLevelId)?.elevation??0;
  const bounds=useMemo(()=>modelBounds(props.project.elements),[props.project.elements]);
  const activeProps={...props,fitKey:props.fitKey+localFit};
  useEffect(()=>{setNotice('');document.body.style.cursor='auto';return()=>{document.body.style.cursor='auto';};},[props.tool,props.viewMode]);
  if(props.viewMode!=='3d')return <PlanEditor {...props}/>;
  const fallback=<div className="model-viewport" style={{height:'100%',position:'relative'}}><PlanEditor {...props} viewMode="plan"/><div className="viewport-webgl-note" role="status">3D rendering is unavailable in this browser. The editable floor plan is available.</div></div>;
  if(!webgl)return fallback;
  function select(event:ThreeEvent<PointerEvent>,element:BimElement){
    event.stopPropagation();if(props.tool!=='select')return;
    const additive=event.ctrlKey||event.metaKey||event.shiftKey;
    props.onSelect(additive?(props.selectedIds.includes(element.id)?props.selectedIds.filter(id=>id!==element.id):[...props.selectedIds,element.id]):[element.id]);
  }
  return <div className="model-viewport" style={{position:'relative',width:'100%',height:'100%',minHeight:350,background:'#f0f1f3'}}>
    <ViewportBoundary fallback={fallback}>
      <Canvas shadows dpr={[1,1.8]} camera={{position:[19,16,21],fov:36,near:.05,far:2000}} gl={{antialias:true,alpha:false}} onPointerMissed={()=>{if(props.tool==='select')props.onSelect([]);}} aria-label="Interactive 3D building model" style={{cursor:props.tool==='select'?'grab':'crosshair'}}>
        <color attach="background" args={['#f0f1f3']}/><fog attach="fog" args={['#f0f1f3',65,180]}/>
        <ambientLight intensity={.85}/><hemisphereLight args={['#ffffff','#b4a68d',.9]}/>
        <directionalLight position={[12,22,8]} intensity={1.9} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-22} shadow-bias={-.0004} shadow-normalBias={.05}/>
        <directionalLight position={[-8,8,-12]} intensity={.6}/>
        <Suspense fallback={null}>
          {props.project.elements.map(element=><BuildingElement key={element.id} element={element} all={props.project.elements} selected={props.selectedIds.includes(element.id)} ghost={props.ghostUpper&&element.z>levelElevation+.6} onSelect={select}/>)}
          <mesh rotation={[-Math.PI/2,0,0]} position={[(bounds.minX+bounds.maxX)/2,-.035,(bounds.minY+bounds.maxY)/2]} receiveShadow><planeGeometry args={[500,500]}/><meshStandardMaterial color="#efefed" roughness={1}/></mesh>
          {props.showGrid&&<Grid position={[0,-.023,0]} args={[100,100]} cellSize={1} sectionSize={5} cellThickness={.55} sectionThickness={.8} cellColor="#d7d7d8" sectionColor="#c8c9ce" fadeDistance={45} fadeStrength={1.4} infiniteGrid/>}
          <DrawingPlane props={props} onNotice={setNotice}/>
        </Suspense>
        <OrbitControls ref={controlsRef} makeDefault minPolarAngle={.04} maxPolarAngle={Math.PI/2-.025} minDistance={3} maxDistance={150} enableDamping dampingFactor={.09} enabled={props.tool==='select'}/>
        <FitCamera props={activeProps} controlsRef={controlsRef} view={view}/>
      </Canvas>
    </ViewportBoundary>
    <div className="viewport-view-name">{view==='top'?'Top view':view==='front'?'South view':'Perspective'}<span>{props.ghostUpper?'BUILDING CUTAWAY':'3D MODEL'}</span></div>
    <div className="viewport-north"><Compass size={28} strokeWidth={1.1}/><span>N</span></div>
    <div className="viewport-orbit-hint"><span className="mouse-glyph"/>Drag to orbit<span>·</span>Right drag to pan<span>·</span>Scroll to zoom</div>
    <div className="viewport-nav"><button title="Perspective view" aria-label="Perspective view" className={view==='perspective'?'active':''} onClick={()=>{setView('perspective');setLocalFit(v=>v+1);}}><Eye size={16}/></button><button title="Top view" aria-label="Top view" className={view==='top'?'active':''} onClick={()=>{setView('top');setLocalFit(v=>v+1);}}><span style={{fontSize:11,fontWeight:650}}>TOP</span></button><button title="South view" aria-label="South view" className={view==='front'?'active':''} onClick={()=>{setView('front');setLocalFit(v=>v+1);}}><span style={{fontSize:11,fontWeight:650}}>S</span></button><button title="Fit building" aria-label="Fit building" onClick={()=>setLocalFit(v=>v+1)}><Scan size={16}/></button></div>
    {(notice||props.tool!=='select')&&<div className={`viewport-tool-hint ${notice?'has-warning':''}`} role="status">{notice||(['door','window'].includes(props.tool)?`Click a wall location to place a ${props.tool}`:`Drag on the active level to draw a ${props.tool} · Plan view offers precise placement`)}</div>}
    {!props.project.elements.length&&<div className="viewport-empty"><span>A place for your next idea</span><p>Draw on the active level or import an IFC model to begin.</p></div>}
  </div>;
}
