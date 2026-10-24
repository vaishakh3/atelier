import {describe,it,expect} from 'vitest';
import {createBlankProject} from '../src/domain/seed';
import {previewLayout} from '../src/domain/layout';
import {previewUpperFloor} from '../src/domain/upperFloor';
import {applyProposal} from '../src/domain/transactions';
import type {AiProposal,LayoutRoom,Project} from '../src/domain/types';
function fixture():Project{
 const blank=createBlankProject('One floor'),rooms:LayoutRoom[]=[{key:'living',name:'Living room',use:'living',area:25,attachedTo:null},{key:'kitchen',name:'Kitchen',use:'kitchen',area:12,attachedTo:null},{key:'dining',name:'Dining',use:'dining',area:14,attachedTo:null},...[1,2,3].map(n=>({key:`bed${n}`,name:`Bedroom ${n}`,use:'bedroom' as const,area:14,attachedTo:null})),{key:'bath',name:'Bathroom',use:'bathroom',area:5,attachedTo:null}];
 const preview=previewLayout(blank,{levelId:blank.levels[0].id,footprintId:null,width:null,depth:null,storeys:1,rooms,idPrefix:'upper-source-house'});expect(preview.issues).toEqual([]);return{...blank,elements:preview.elements};
}
function proposal(project:Project):AiProposal{
 const upperFloor={baseLevelId:project.levels[0].id,rooms:[{key:'theatre',name:'Home theatre',use:'theater' as const,area:40,attachedTo:null},{key:'bathroom',name:'Bathroom',use:'bathroom' as const,area:5,attachedTo:null}],floorHeight:3.2,baselineVersion:project.version,idPrefix:'upper-floor-reviewed'},derived=previewUpperFloor(project,upperFloor);expect(derived.issues).toEqual([]);
 return{id:upperFloor.idPrefix,prompt:'Add an upper floor with a huge home theatre and a bathroom',summary:'Add one upper floor',kind:'edit',model:'fixture',createdAt:new Date().toISOString(),selectedIds:[],changes:derived.changes,creations:derived.creations,removals:derived.removals,levelCreations:derived.levelCreations,issues:derived.notes,upperFloor};
}
describe('reviewed upper-floor transactions',()=>{
 it('adds the complete floor/access as one revision while preserving every existing non-roof element and level',()=>{
  const project=fixture(),before=structuredClone(project),p=proposal(project),next=applyProposal(project,p);expect(next.version).toBe(project.version+1);expect(next.audit).toHaveLength(project.audit.length+1);expect(next.levels.slice(0,project.levels.length)).toEqual(before.levels);expect(next.levels).toHaveLength(2);
  for(const element of before.elements)expect(next.elements.find(item=>item.id===element.id)).toEqual(element);
  expect(p.creations!.some(c=>c.after.kind==='stair')).toBe(true);expect(p.creations!.some(c=>c.after.kind==='room'&&c.after.properties.use==='theater')).toBe(true);expect(next.schedule).toEqual(before.schedule);expect(next.types).toEqual(before.types);expect(project).toEqual(before);
 });
 it('rejects stale/missing/changed/extra additions and existing-ground modifications without partial mutation',()=>{
  const project=fixture(),before=structuredClone(project),p=proposal(project);
  const changed=structuredClone(p);changed.creations![0].after.width+=1;expect(()=>applyProposal(project,changed)).toThrow(/diff/);
  const missing=structuredClone(p);missing.creations!.pop();expect(()=>applyProposal(project,missing)).toThrow(/diff/);
  const levels=structuredClone(p);levels.levelCreations![0].after.elevation+=1;expect(()=>applyProposal(project,levels)).toThrow(/diff/);
  const hidden=structuredClone(p),room=project.elements.find(e=>e.kind==='room')!;hidden.changes.push({elementId:room.id,before:room,after:{...room,name:'Hidden ground change'}});expect(()=>applyProposal(project,hidden)).toThrow(/diff/);
  expect(()=>applyProposal({...project,version:project.version+1},p)).toThrow(/changed after/);expect(()=>applyProposal(project,{...p,selectedIds:[room.id]})).toThrow(/separate/);expect(project).toEqual(before);
 });
 it('rechecks new-level locks and component approvals at acceptance',()=>{
  const project=fixture(),p=proposal(project);
  expect(()=>applyProposal({...project,constraints:{...project.constraints,lockedProperties:['levels']}},p)).toThrow(/locked/i);
  expect(()=>applyProposal({...project,constraints:{...project.constraints,lockedProperties:['geometry']}},p)).toThrow(/locked/i);
  const invalid=structuredClone(project);invalid.types.find(t=>t.kind==='stair')!.approved=false;expect(()=>applyProposal(invalid,p)).toThrow(/approved|type/i);
 });
});
