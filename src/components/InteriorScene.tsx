import {Component,forwardRef,Suspense,useEffect,useImperativeHandle,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Canvas,useThree} from '@react-three/fiber';
import {Edges,OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import type {BimElement,Project} from '../domain/types';
import type {FurnitureAsset,FurniturePlacement} from '../interior/types';
import {FURNITURE_CATALOG} from '../interior/catalog';
import {radians,wallSegments} from '../model/geometry';
import {interiorCameraFrame} from '../interior/sceneGeometry';
import SiteGeometry from '../site/SiteGeometry';

export interface InteriorSceneHandle {capture:()=>string}
export interface InteriorSceneProps {project:Project;levelId:string;roomId:string;placements:FurniturePlacement[];selectedId?:string;onSelect?:(id:string)=>void;view?:'dollhouse'|'interior'|'exterior';onReady?:(ready:boolean)=>void}
const box=(size:[number,number,number],position:[number,number,number],color:string,key?:string|number)=><mesh key={key} position={position} castShadow receiveShadow><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={.78}/></mesh>;
/** Procedural catalogue proxies use the immutable supplier SKU envelope, in metres. */
export function FurnitureMesh({asset:a,placement:p,elevation,selected=false,onSelect}:{asset:FurnitureAsset;placement:FurniturePlacement;elevation:number;selected?:boolean;onSelect?:()=>void}){
 const w=a.width,d=a.depth,h=a.height,wood='#aa8763',fabric=a.color,legH=Math.min(.16,h*.2),seatH=Math.min(.44,h*.55),parts:ReactNode[]=[];
 const legs=(height:number,top:number,inset=.09)=>[-1,1].flatMap(x=>[-1,1].map(y=>box([.055,height,.055],[x*(w/2-inset),top-height/2,y*(d/2-inset)],wood,`leg${x}${y}`)));
 if(a.category==='sofa'){
  parts.push(...legs(legH,legH),box([w,.2,d],[0,legH+.1,0],fabric,'base'),box([w,.43,Math.min(.19,d*.22)],[0,h-.215,-d/2+Math.min(.19,d*.22)/2],fabric,'back'));
  const arm=Math.min(.14,w*.1);parts.push(box([arm,h-legH,d],[-w/2+arm/2,(h+legH)/2,0],fabric,'left'),box([arm,h-legH,d],[w/2-arm/2,(h+legH)/2,0],fabric,'right'));
  const n=w>1.8?3:2;for(let i=0;i<n;i++)parts.push(box([(w-2*arm)/n-.015,.12,d*.71],[-w/2+arm+(i+.5)*(w-2*arm)/n,legH+.24,d*.06],fabric,`cushion${i}`));
 }else if(a.category==='chair'){
  parts.push(...legs(seatH-.065,seatH-.065,.06),box([w,.13,d],[0,seatH,0],fabric,'seat'),box([w,Math.max(.1,h-seatH),.065],[0,(h+seatH)/2,-d/2+.033],fabric,'back'));
 }else if(a.category==='bed'){
  const mattress=Math.min(.19,h*.32);parts.push(box([w,.19,d],[0,.16,0],wood,'frame'),box([w*.96,mattress,d*.96],[0,.255+mattress/2,0],fabric,'mattress'),box([w,h,.055],[0,h/2,-d/2+.028],wood,'headboard'));
  [-1,1].forEach((x,i)=>parts.push(box([w*.38,.095,Math.min(.42,d*.23)],[x*w*.23,.3+mattress,-d*.31],'#f4efe5',`pillow${i}`)));
 }else if(a.category==='cabinet'){
  parts.push(box([w,h,d-.04],[0,h/2,-.02],fabric,'body'));[-1,1].forEach((x,i)=>parts.push(box([w*.47,h*.95,.018],[x*w*.245,h/2,d/2-.012],wood,`door${i}`)));parts.push(box([.02,h*.2,.035],[.035,h*.52,d/2-.018],'#77736c','pull'));
 }else{
  const thickness=Math.min(.07,h*.12);parts.push(box([w,thickness,d],[0,h-thickness/2,0],fabric,'top'),...legs(h-thickness,h-thickness,Math.min(.11,w*.12,d*.12)));
  if(a.category==='desk')parts.push(box([Math.min(.38,w*.3),h*.4,d*.75],[w*.28,h*.55,0],wood,'drawers'));
 }
 return <group position={[p.x,elevation,p.y]} rotation={[0,-radians(p.rotation),0]} onClick={event=>{event.stopPropagation();onSelect?.();}}>{parts}{selected&&<mesh position={[0,.025,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[w+.045,d+.045]}/><meshBasicMaterial color="#8565ce" transparent opacity={.3} side={THREE.DoubleSide}/><Edges color="#7457bd"/></mesh>}</group>;
}
function BuildingPart({element:e,all,cutaway}:{element:BimElement;all:BimElement[];cutaway:boolean}){
 const color=e.kind==='slab'?'#d6c9b4':e.kind==='door'?'#b79970':e.kind==='window'?'#b8dbe2':e.kind==='roof'?'#b9b6af':'#e6e1d6';
 const shape=useMemo(()=>{if(!e.footprint?.length)return null;const s=new THREE.Shape();s.moveTo(e.footprint[0].x,-e.footprint[0].y);e.footprint.slice(1).forEach(p=>s.lineTo(p.x,-p.y));s.closePath();return s;},[e.footprint]);
 if(e.kind==='room'||e.kind==='reference'||(e.kind==='roof'&&cutaway))return null;
 return <group position={[e.x,e.z,e.y]} rotation={[0,-radians(e.rotation),0]}>{shape?<mesh rotation={[-Math.PI/2,0,0]} receiveShadow><extrudeGeometry args={[shape,{depth:e.height,bevelEnabled:false}]}/><meshStandardMaterial color={color}/></mesh>:e.kind==='wall'?wallSegments(e,all).filter(part=>!cutaway||part.bottom<1.1).map((part,index)=>{const height=cutaway?Math.min(part.height,1.1-part.bottom):part.height;return box([part.width,height,e.depth],[part.x+part.width/2,part.bottom+height/2,e.depth/2],color,index);}):e.kind==='window'?<mesh position={[e.width/2,e.height/2,e.depth/2]}><boxGeometry args={[e.width,e.height,.04]}/><meshStandardMaterial color={color} transparent opacity={.35} roughness={.08}/></mesh>:e.kind==='stair'?Array.from({length:Math.min(32,Number(e.properties.steps)||16)},(_,index)=>{const n=Math.min(32,Number(e.properties.steps)||16),height=e.height*(index+1)/n;return box([e.width,height,e.depth/n],[e.width/2,height/2,e.depth*(index+.5)/n],color,index);}):box([e.width,cutaway&&e.kind==='door'?Math.min(.9,e.height):e.height,e.depth],[e.width/2,(cutaway&&e.kind==='door'?Math.min(.9,e.height):e.height)/2,e.depth/2],color)}</group>;
}
function CameraBridge({props,capture}:{props:InteriorSceneProps;capture:React.RefObject<(()=>string)|null>}){
 const {camera,gl,scene,invalidate,size}=useThree(),controls=useRef<any>(null);
 useEffect(()=>{
  const frame=interiorCameraFrame(props.project,props.levelId,props.roomId,props.view),position=new THREE.Vector3(...frame.position),target=new THREE.Vector3(...frame.target);
  camera.position.copy(position);camera.up.set(0,1,0);camera.lookAt(target);camera.updateProjectionMatrix();if(controls.current){controls.current.target.copy(target);controls.current.update();}invalidate();
 },[props.project.id,props.levelId,props.roomId,props.view,camera,invalidate]);
 useEffect(()=>{
  capture.current=()=>{
   const c=camera as THREE.PerspectiveCamera,oldAspect=c.aspect,oldSize=gl.getSize(new THREE.Vector2()),oldRatio=gl.getPixelRatio();
   try{gl.setPixelRatio(1);gl.setSize(1536,864,false);c.aspect=16/9;c.updateProjectionMatrix();gl.render(scene,c);return gl.domElement.toDataURL('image/png');}
   finally{gl.setPixelRatio(oldRatio);gl.setSize(oldSize.x,oldSize.y,false);c.aspect=oldAspect||size.width/size.height;c.updateProjectionMatrix();invalidate();}
  };props.onReady?.(true);return()=>{capture.current=null;props.onReady?.(false);};
 },[camera,gl,scene,capture,invalidate,props.onReady,size.width,size.height]);
 return <OrbitControls ref={controls} makeDefault minDistance={.2} maxDistance={200} enableDamping dampingFactor={.1}/>;
}
class SceneBoundary extends Component<{children:ReactNode;onFailure:()=>void},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true};}componentDidCatch(){this.props.onFailure();}render(){return this.state.failed?<div className="interior-scene-fallback" role="status">3D is unavailable. Use the measured plan to arrange furniture. Rendering needs a working 3D view.</div>:this.props.children;}}
const InteriorScene=forwardRef<InteriorSceneHandle,InteriorSceneProps>(function InteriorScene(props,ref){
 const capture=useRef<(()=>string)|null>(null),[webgl]=useState(()=>{try{return !!document.createElement('canvas').getContext('webgl2');}catch{return false;}});
 useImperativeHandle(ref,()=>({capture:()=>{if(!capture.current)throw new Error('The 3D view is not ready. Open the 3D view and try again.');return capture.current();}}),[]);
 const visible=props.project.elements.filter(e=>props.view==='exterior'||e.levelId===props.levelId),base=props.project.levels.find(l=>l.id===props.levelId)?.elevation??0;
 if(!webgl)return <div className="interior-scene-fallback" role="status">3D is unavailable. Use the measured plan to arrange furniture. Rendering needs a working 3D view.</div>;
 return <SceneBoundary onFailure={()=>props.onReady?.(false)}><Canvas shadows dpr={[1,1.6]} camera={{fov:props.view==='interior'?66:38,near:.04,far:2000,position:[10,12,10]}} gl={{antialias:true,preserveDrawingBuffer:true}} aria-label="Interactive furnished 3D model"><color attach="background" args={['#eeede8']}/><ambientLight intensity={1.05}/><hemisphereLight args={['#fffaf0','#b7a68d',1]}/><directionalLight position={[8,18,12]} intensity={2.3} castShadow shadow-mapSize={[2048,2048]}/><directionalLight position={[-8,5,-9]} intensity={.8}/><Suspense fallback={null}><SiteGeometry site={props.project.site}/>{visible.map(e=><BuildingPart key={e.id} element={e} all={props.project.elements} cutaway={props.view==='dollhouse'}/>)}{props.placements.filter(p=>props.view==='exterior'||p.levelId===props.levelId).map(p=>{const asset=FURNITURE_CATALOG.find(a=>a.id===p.assetId);return asset?<FurnitureMesh key={p.id} asset={asset} placement={p} elevation={props.project.elements.find(e=>e.id===p.roomId)?.z??props.project.levels.find(l=>l.id===p.levelId)?.elevation??0} selected={p.id===props.selectedId} onSelect={()=>props.onSelect?.(p.id)}/>:null;})}<mesh rotation={[-Math.PI/2,0,0]} position={[0,props.view==='exterior'?-.25:base-.25,0]} receiveShadow><planeGeometry args={[500,500]}/><meshStandardMaterial color="#e0e1d7" roughness={1}/></mesh></Suspense><CameraBridge props={props} capture={capture}/></Canvas></SceneBoundary>;
});
export default InteriorScene;
