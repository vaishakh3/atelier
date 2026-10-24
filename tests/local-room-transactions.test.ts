import {describe,it,expect} from 'vitest';
import {createBlankProject} from '../src/domain/seed';
import {previewLayout} from '../src/domain/layout';
import {previewLocalRoomEdit} from '../src/domain/localRoomEdit';
import {applyProposal} from '../src/domain/transactions';
import {localRoomEditSpecSchema} from '../src/domain/schema';
import type {AiProposal,LayoutRoom,LocalRoomEditSpec,Project} from '../src/domain/types';
function fixture(){
 const blank=createBlankProject('Local scope transactions'),rooms:LayoutRoom[]=Array.from({length:5},(_,i)=>[{key:`bed-${i+1}`,name:`Bedroom ${i+1}`,use:'bedroom' as const,area:14,attachedTo:null,floor:1 as const},{key:`ensuite-${i+1}`,name:`Ensuite ${i+1}`,use:'bathroom' as const,area:4.5,attachedTo:`bed-${i+1}`,floor:1 as const}]).flat();rooms.push({key:'living',name:'Living room',use:'living',area:20,attachedTo:null,floor:0},{key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null,floor:0});
 const generated=previewLayout(blank,{levelId:blank.levels[0].id,footprintId:null,width:null,depth:null,rooms,storeys:2,floorHeight:3.8,idPrefix:'local-transaction-house'});expect(generated.issues).toEqual([]);
 const project:Project={...blank,elements:generated.elements,levels:[...blank.levels,...generated.levels]},room=project.elements.find(e=>e.kind==='room'&&e.name==='Bedroom 5')!;
 return{project,room};
}
function proposal(project:Project,edit:LocalRoomEditSpec):AiProposal{
 const localEdit={...edit,baselineVersion:project.version,idPrefix:'local-reviewed-test'},p=previewLocalRoomEdit(project,localEdit);expect(p.issues).toEqual([]);
 return{id:localEdit.idPrefix,prompt:'A local room edit',summary:'Adjust the local room boundary',kind:'edit',model:'Atelier planning engine',createdAt:new Date().toISOString(),selectedIds:edit.action==='resize-room'?[edit.roomId]:edit.roomIds,issues:p.notes,changes:p.changes,creations:p.creations,removals:p.removals,localEdit};
}
describe('atomic bounded local room transactions',()=>{
 it('applies exactly the reviewed neighborhood, retains unrelated snapshots and floors, and increments one undoable revision',()=>{
  const {project,room}=fixture(),before=structuredClone(project),p=proposal(project,{action:'resize-room',roomId:room.id,targetArea:room.width*room.depth*1.2}),next=applyProposal(project,p),affected=new Set(next.audit[0].affectedIds);
  expect(next.version).toBe(project.version+1);expect(next.audit).toHaveLength(project.audit.length+1);expect(next.levels).toEqual(before.levels);expect(next.schedule).toEqual(before.schedule);expect(next.types).toEqual(before.types);
  for(const element of before.elements)if(!affected.has(element.id))expect(next.elements.find(e=>e.id===element.id)).toEqual(element);
  for(const element of before.elements.filter(e=>e.levelId===before.levels[0].id||e.kind==='slab'||e.kind==='stair'))expect(next.elements.find(e=>e.id===element.id)).toEqual(element);
  const grown=next.elements.find(e=>e.id===room.id)!;expect(grown.width*grown.depth).toBeCloseTo(room.width*room.depth*1.2,6);expect(project).toEqual(before);
 });
 it('rejects stale, missing, extra, altered and out-of-scope reviewed diffs atomically',()=>{
  const {project,room}=fixture(),before=structuredClone(project),p=proposal(project,{action:'resize-room',roomId:room.id,targetArea:room.width*room.depth*1.2});
  const altered=structuredClone(p);altered.changes[0].after.width=123;expect(()=>applyProposal(project,altered)).toThrow(/diff/);
  const incomplete=structuredClone(p);incomplete.changes.pop();expect(()=>applyProposal(project,incomplete)).toThrow(/diff/);
  const extra=structuredClone(p),unrelated=project.elements.find(e=>e.kind==='stair')!;extra.changes.push({elementId:unrelated.id,before:unrelated,after:{...unrelated,name:'Hidden edit'}});expect(()=>applyProposal(project,extra)).toThrow(/diff/);
  expect(()=>applyProposal({...project,version:project.version+1},p)).toThrow(/changed after/);
  expect(()=>applyProposal(project,{...p,selectedIds:['other-room']})).toThrow(/exactly/);
  expect(()=>applyProposal(project,{...p,layout:{}}as AiProposal)).toThrow(/separately/);expect(project).toEqual(before);
 });
 it('rechecks actual affected neighbors, property locks and approved types at acceptance',()=>{
  const {project,room}=fixture(),p=proposal(project,{action:'resize-room',roomId:room.id,targetArea:room.width*room.depth*1.2}),neighbor=p.changes.find(c=>c.elementId!==room.id&&c.after.kind==='room')!;expect(neighbor).toBeDefined();
  expect(()=>applyProposal({...project,constraints:{...project.constraints,lockedElementIds:[neighbor.elementId]}},p)).toThrow(/locked|local|safe|affected|partition/i);
  for(const lock of ['geometry',`${room.id}.width`,'elements.*'])expect(()=>applyProposal({...project,constraints:{...project.constraints,lockedProperties:[lock]}},p)).toThrow();
  const unapproved=structuredClone(project);unapproved.types.find(t=>t.id===room.typeId)!.approved=false;expect(()=>applyProposal(unapproved,p)).toThrow(/approved|component/i);
 });
 it('accepts a local study replacement without deleting its envelope, unrelated rooms or retained openings',()=>{
  const {project}=fixture(),ids=[3,5].map(n=>project.elements.find(e=>e.name===`Bedroom ${n}`)!.id),before=structuredClone(project),p=proposal(project,{action:'replace-rooms',roomIds:ids,name:'Study',use:'study'}),next=applyProposal(project,p),affected=new Set(next.audit[0].affectedIds);
  expect(next.elements.find(e=>e.id===ids[0])).toMatchObject({name:'Study',properties:{use:'study'}});expect(next.elements.some(e=>e.id===ids[1])).toBe(false);expect(p.removals!.some(r=>r.before.kind==='wall')).toBe(true);
  for(const e of before.elements)if(!affected.has(e.id))expect(next.elements.find(item=>item.id===e.id)).toEqual(e);
  expect(next.levels).toEqual(before.levels);expect(project).toEqual(before);
  const tampered=structuredClone(p);tampered.removals!.push({elementId:project.elements[0].id,before:project.elements[0],after:null});expect(()=>applyProposal(project,tampered)).toThrow(/diff/);
 });
 it('validates local spec IDs, bounds and hidden fields without exposing raw geometry operations',()=>{
  expect(localRoomEditSpecSchema.safeParse({action:'resize-room',roomId:'room',targetArea:18}).success).toBe(true);
  for(const targetArea of [0,NaN,Infinity,301])expect(localRoomEditSpecSchema.safeParse({action:'resize-room',roomId:'room',targetArea}).success).toBe(false);
  expect(localRoomEditSpecSchema.safeParse({action:'replace-rooms',roomIds:['room2','room3'],name:'Study',use:'study',deleteHouse:true}).success).toBe(false);
 });
});
