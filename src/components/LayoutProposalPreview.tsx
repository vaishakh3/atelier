import {useId,useMemo,useState} from 'react';
import {ArrowUpRight,Check,Expand,Home,Layers,X} from 'lucide-react';
import type {AiProposal,BimElement,Project} from '../domain/types';
import {createPlanDrawing} from '../model/drawings';
import {formatDistance} from '../model/geometry';
import {Modal,Notice,Pill,num} from './ui';
import './LayoutProposalPreview.css';

type Props={source:Project;preview:Project;proposal:AiProposal;disabled:boolean;onAccept:()=>void;onReject:()=>void};
const displayUse=(value:unknown)=>typeof value==='string'?value.replace(/(^|[-_ ])\w/g,letter=>letter.replace(/[-_]/,' ').toUpperCase()):'Room';
function PlanPreview({project,levelId,compact=false}:{project:Project;levelId:string;compact?:boolean}){
 const patternId=useId().replace(/:/g,''),drawing=useMemo(()=>createPlanDrawing(project,levelId,true),[project,levelId]);
 const {minX,minY,maxX,maxY}=drawing.bounds,width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY),padding=Math.max(width,height)*.055;
 return <div className={`layout-plan-preview ${compact?'compact':''}`}><svg viewBox={`${minX-padding} ${minY-padding} ${width+padding*2} ${height+padding*2}`} role="img" aria-label="Proposed house floor plan with room names, areas and footprint dimensions" preserveAspectRatio="xMidYMid meet">
  <title>Proposed house layout</title><desc>Unsaved model-derived plan. Review the room and element dimensions before accepting.</desc>
  <defs><pattern id={patternId} width=".5" height=".5" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".012" fill="#dedce6"/></pattern></defs>
  <rect x={minX-padding} y={minY-padding} width={width+padding*2} height={height+padding*2} fill={`url(#${patternId})`}/>
  {drawing.primitives.map((primitive,index)=>primitive.kind==='text'?<text key={index} x={primitive.points[0]?.x} y={primitive.points[0]?.y} textAnchor={primitive.anchor??'middle'} fontSize={primitive.fontSize??.2} fill={primitive.stroke}>{primitive.text}</text>:primitive.kind==='polygon'?<polygon key={index} points={primitive.points.map(point=>`${point.x},${point.y}`).join(' ')} stroke={primitive.stroke} fill={primitive.fill??'none'} strokeWidth={primitive.width??.02} strokeDasharray={primitive.dashed?'.08 .06':undefined}/>:<polyline key={index} points={primitive.points.map(point=>`${point.x},${point.y}`).join(' ')} stroke={primitive.stroke} fill="none" strokeWidth={primitive.width??.02} strokeDasharray={primitive.dashed?'.08 .06':undefined}/>)}
 </svg><span className="layout-preview-watermark">PROPOSAL · UNSAVED</span></div>;
}
function area(value:number,units:Project['units']){return`${num(value*(units==='ft'?10.7639104167:1),1)} ${units==='ft'?'ft²':'m²'}`;}
function RoomSchedule({rooms,units,compact=false}:{rooms:BimElement[];units:Project['units'];compact?:boolean}){
 const names=new Map(rooms.map(room=>[String(room.properties.layoutKey||''),room.name]));
 return <div className={`layout-review-table ${compact?'compact':''}`}><table><caption>Proposed room dimensions</caption><thead><tr><th>Room</th><th>Clear size · {units}</th><th>Area</th>{!compact&&<><th>Target</th><th>Access</th></>}</tr></thead><tbody>{rooms.map(room=>{
  const requested=room.properties.requestedArea,attached=room.properties.attachedTo;
  return <tr key={room.id}><td><strong>{room.name}</strong>{!compact&&<small>{displayUse(room.properties.use)}</small>}</td><td>{num(room.width*(units==='ft'?3.280839895:1),2)} × {num(room.depth*(units==='ft'?3.280839895:1),2)}</td><td>{area(room.width*room.depth,units)}</td>{!compact&&<><td>{typeof requested==='number'&&requested>0?area(requested,units):'Auto-sized'}</td><td>{typeof attached==='string'&&attached?`Via ${names.get(attached)||attached}`:room.properties.use==='circulation'?'Entrance':'Circulation'}</td></>}</tr>;
 })}</tbody></table></div>;
}
export default function LayoutProposalPreview({source,preview,proposal,disabled,onAccept,onReject}:Props){
 const [expanded,setExpanded]=useState(false),layout=proposal.layout;
 const created=proposal.creations?.map(creation=>creation.after)??[],createdIds=new Set(created.map(element=>element.id)),rooms=created.filter(element=>element.kind==='room');
 const footprint=source.elements.find(element=>element.id===layout?.footprintId)??created.find(element=>element.kind==='slab');
 const scope=useMemo(()=>({...preview,elements:preview.elements.filter(element=>createdIds.has(element.id)||element.id===layout?.footprintId)}),[preview,proposal]);
 if(!layout)return null;
 const levelName=preview.levels.find(level=>level.id===layout.levelId)?.name||'Building level';
 const counts=['wall','door','window'].map(kind=>`${created.filter(element=>element.kind===kind).length} ${kind}s`);
 const basis=footprint?`${formatDistance(footprint.width,source.units)} × ${formatDistance(footprint.depth,source.units)}`:'Auto-sized footprint';
 const accept=()=>{if(disabled)return;setExpanded(false);onAccept();},reject=()=>{setExpanded(false);onReject();};
 return <div className="layout-proposal-preview">
  <div className="layout-preview-heading"><Home size={14}/><strong>House layout preview</strong><Pill>Not applied</Pill></div>
  <PlanPreview project={scope} levelId={layout.levelId} compact/>
  <div className="layout-preview-basis"><strong>{basis}</strong><span>{levelName} · {footprint&&layout.footprintId?'Selected slab':'New footprint'}</span><small>{rooms.length} spaces · {counts.join(' · ')}</small></div>
  <RoomSchedule rooms={rooms} units={source.units} compact/>
  <button className="button small full" onClick={()=>setExpanded(true)}><Expand size={13}/>Review plan & all {created.length} elements<ArrowUpRight size={13}/></button>
  <p className="layout-preview-caption">Concept geometry only. Review the footprint, access and room sizes before adding it to your model.</p>
  {expanded&&<Modal title="Review proposed house layout" wide onClose={()=>setExpanded(false)}><div className="modal-body layout-review-body">
   <div className="layout-review-summary"><Pill><Layers size={11}/>{levelName}</Pill><Pill>{basis}</Pill><Pill>{created.length} new elements</Pill><Pill tone="amber">Unsaved preview</Pill></div>
   <Notice>Accepting adds this layout in one undoable transaction. Closing or rejecting this preview leaves the project unchanged.</Notice>
   <PlanPreview project={scope} levelId={layout.levelId}/>
   <h3>Room sizes & access</h3><RoomSchedule rooms={rooms} units={source.units}/>
   <h3>Elements to be created</h3><div className="layout-review-table elements"><table><caption>Complete proposed creation list</caption><thead><tr><th>Element</th><th>Type</th><th>Dimensions · {source.units}</th><th>Host</th></tr></thead><tbody>{created.map(element=><tr key={element.id}><td><strong>{element.name}</strong><small>{element.id}</small></td><td>{element.kind}</td><td>{[element.width,element.depth,element.height].map(value=>num(value*(source.units==='ft'?3.280839895:1),2)).join(' × ')}</td><td>{element.hostId?created.find(host=>host.id===element.hostId)?.name||element.hostId:'—'}</td></tr>)}</tbody></table></div>
   {proposal.issues.length>0&&<><h3>Assumptions to review</h3>{proposal.issues.map((issue,index)=><Notice key={index} warning>{issue}</Notice>)}</>}
   <p className="layout-preview-caption">Plan, room areas and dimensions are derived from the proposed BIM elements. Existing project elements remain unchanged.</p>
  </div><footer><button className="button" onClick={reject}><X size={13}/>Reject layout</button><button className="button primary" disabled={disabled} onClick={accept}><Check size={13}/>Accept layout</button></footer></Modal>}
 </div>;
}
