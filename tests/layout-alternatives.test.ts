import {describe,expect,it} from 'vitest';
import {generateLayoutAlternatives} from '../src/domain/layoutAlternatives';
import {previewLayout} from '../src/domain/layout';
import {createBlankProject} from '../src/domain/seed';
import {applyProposal} from '../src/domain/transactions';
import type {AiProposal,LayoutProposal,Project} from '../src/domain/types';

function proposalFor(project:Project,patch:Partial<LayoutProposal>={}):AiProposal {
 const layout:LayoutProposal={levelId:project.levels[0].id,footprintId:null,width:null,depth:null,idPrefix:'alternatives-test',baselineVersion:project.version,rooms:[
  {key:'living',name:'Living room',use:'living',area:20,attachedTo:null,floor:0},
  {key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null,floor:0},
  {key:'dining',name:'Dining room',use:'dining',area:12,attachedTo:null,floor:0},
  {key:'bedroom',name:'Primary bedroom',use:'bedroom',area:14,attachedTo:null,floor:1},
  {key:'ensuite',name:'Primary ensuite',use:'bathroom',area:4.5,attachedTo:'bedroom',floor:1},
 ],storeys:2,...patch};
 const result=previewLayout(project,layout);expect(result.issues).toEqual([]);
 return{id:layout.idPrefix,prompt:'A two-storey home with public rooms downstairs and the primary suite upstairs',summary:'A reviewable house',kind:'layout',changes:[],issues:result.assumptions,selectedIds:layout.footprintId?[layout.footprintId]:[],model:'gpt-6.1-sol',createdAt:'2026-10-24T12:00:00Z',layout,creations:result.elements.map(after=>({elementId:after.id,before:null,after})),levelCreations:result.levels.map(after=>({levelId:after.id,before:null,after})),removals:result.removedElements.map(before=>({elementId:before.id,before,after:null}))};
}

describe('locally reviewable house alternatives',()=>{
 it('keeps the exact provider response as the initial choice and never mutates the source or programme',()=>{
  const source=createBlankProject('Alternative source'),provider=proposalFor(source),before=structuredClone(source),original=structuredClone(provider);
  const result=generateLayoutAlternatives(source,provider),repeat=generateLayoutAlternatives(source,provider);
  expect(result.alternatives.length).toBeGreaterThanOrEqual(1);expect(result.alternatives.length).toBeLessThanOrEqual(3);
  expect(result.alternatives[0].proposal).toBe(provider);expect(result.alternatives[0].variant).toBe('balanced');
  expect(result.alternatives.map(option=>option.id)).toEqual(repeat.alternatives.map(option=>option.id));
  expect(new Set(result.alternatives.map(option=>option.id)).size).toBe(result.alternatives.length);
  for(const option of result.alternatives){
   expect(option.proposal.layout!.rooms).toEqual(provider.layout!.rooms);expect(option.proposal.layout!.storeys).toBe(2);expect(option.proposal.layout!.footprintId).toBeNull();
   expect(option.proposal.model).toBe(provider.model);expect(option.proposal.prompt).toBe(provider.prompt);expect(option.proposal.createdAt).toBe(provider.createdAt);
   expect(applyProposal(source,option.proposal).elements).toEqual(option.preview.elements);
   for(const room of provider.layout!.rooms){
    const actual=option.result.rooms.find(candidate=>candidate.key===room.key)!;expect(actual).toBeTruthy();
    const level=[...source.levels,...option.result.levels].find(level=>level.id===actual.levelId)!;
    expect(level.elevation).toBe(source.levels[0].elevation+(room.floor??0)*3.2);
   }
   expect(()=>applyProposal({...source,version:source.version+1},option.proposal)).toThrow(/changed|revision|version/i);
  }
  expect(source).toEqual(before);expect(provider).toEqual(original);
 });

 it('retains a rotated surveyed slab exactly for every feasible candidate',()=>{
  const source=createBlankProject('Fixed footprint'),type=source.types.find(type=>type.kind==='slab')!;
  source.elements.push({id:'surveyed-slab',kind:'slab',name:'Surveyed slab',levelId:source.levels[0].id,typeId:type.id,material:type.material,x:29,y:-8,z:-.2,width:16,depth:20,height:.2,rotation:33,editable:true,properties:{}});
  const provider=proposalFor(source,{footprintId:'surveyed-slab'}),before=structuredClone(source),choices=generateLayoutAlternatives(source,provider);
  expect(choices.alternatives.length).toBeGreaterThan(0);
  for(const option of choices.alternatives){
   expect(option.proposal.selectedIds).toEqual(['surveyed-slab']);expect(option.proposal.layout!.footprintId).toBe('surveyed-slab');
   expect(option.preview.elements.find(element=>element.id==='surveyed-slab')).toEqual(source.elements[0]);
   expect(option.result.footprint).toMatchObject({x:29,y:-8,width:16,depth:20,rotation:33,levelId:source.levels[0].id});
  }
  expect(source).toEqual(before);
 });

 it('rejects a tampered original instead of quietly replacing it with a regenerated choice',()=>{
  const source=createBlankProject('Tampered response'),provider=proposalFor(source);provider.creations![0].after.width+=1;
  expect(()=>generateLayoutAlternatives(source,provider)).toThrow();expect(source.elements).toEqual([]);
  const missing=proposalFor(source);delete missing.layout;expect(()=>generateLayoutAlternatives(source,missing)).toThrow(/specification is missing/);
 });

 it('shows only one choice when distinct IDs cannot produce a distinct physical layout',()=>{
  const source=createBlankProject('Single-space constrained programme'),provider=proposalFor(source,{storeys:1,rooms:[{key:'living',name:'Living room',use:'living',area:20,attachedTo:null,floor:0}]}),choices=generateLayoutAlternatives(source,provider);
  expect(choices.alternatives).toHaveLength(1);expect(choices.notes).toHaveLength(2);
  expect(choices.notes.every(note=>note.includes('same physical arrangement'))).toBe(true);
  expect(choices.alternatives[0].proposal).toBe(provider);
 });

 it('does not turn an analysis response into model generation',()=>{
  const source=createBlankProject('Analysis'),analysis:AiProposal={id:'analysis',kind:'analysis',prompt:'Review',summary:'No changes',model:'gpt-6.1-sol',createdAt:'2026-10-24T12:00:00Z',selectedIds:[],changes:[],issues:[]};
  expect(generateLayoutAlternatives(source,analysis)).toEqual({alternatives:[],notes:[]});expect(source.elements).toEqual([]);
 });

 it('offers distinct physical choices for an unconstrained house rather than three renamed copies',()=>{
  const source=createBlankProject('Nine-room choices'),rooms:LayoutProposal['rooms']=[...Array.from({length:3},(_,index)=>[
   {key:`bed${index}`,name:`Bedroom ${index+1}`,use:'bedroom' as const,area:14,attachedTo:null,floor:0 as const},
   {key:`bath${index}`,name:`Ensuite ${index+1}`,use:'bathroom' as const,area:4.5,attachedTo:`bed${index}`,floor:0 as const},
  ]).flat(),{key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null,floor:0},{key:'library',name:'Library',use:'study',area:9,attachedTo:null,floor:0},{key:'pool',name:'Indoor pool zone',use:'pool',area:24,attachedTo:null,floor:0}],provider=proposalFor(source,{rooms,storeys:1}),before=structuredClone(source),choices=generateLayoutAlternatives(source,provider);
  expect(choices.alternatives.length).toBeGreaterThanOrEqual(2);
  const roomGeometry=choices.alternatives.map(option=>JSON.stringify(option.result.rooms.map(room=>{
   const element=option.preview.elements.find(element=>element.id===room.elementId)!;return[room.key,element.x,element.y,element.width,element.depth];
  })));
  expect(new Set(roomGeometry).size).toBe(choices.alternatives.length);
  const allIds=choices.alternatives.flatMap(option=>option.proposal.creations!.map(creation=>creation.elementId));expect(new Set(allIds).size).toBe(allIds.length);
  for(const option of choices.alternatives){expect(option.proposal.layout!.rooms).toEqual(rooms);expect(option.proposal.levelCreations).toHaveLength(0);expect(option.preview.version).toBe(source.version+1);expect(applyProposal(source,option.proposal).elements).toEqual(option.preview.elements);}
  expect(source).toEqual(before);
 });

 it('produces all three reviewable preferences when the programme supports distinct arrangements',()=>{
  const source=createBlankProject('Three physical preferences'),rooms:LayoutProposal['rooms']=[
   {key:'living',name:'Living room',use:'living',area:20,attachedTo:null,floor:null},
   {key:'dining',name:'Dining room',use:'dining',area:12,attachedTo:null,floor:null},
   {key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null,floor:null},
   {key:'bedroom',name:'Bedroom',use:'bedroom',area:14,attachedTo:null,floor:null},
   {key:'ensuite',name:'Ensuite',use:'bathroom',area:4.5,attachedTo:'bedroom',floor:null},
  ],provider=proposalFor(source,{rooms,storeys:1}),choices=generateLayoutAlternatives(source,provider);
  expect(choices.alternatives.map(option=>option.variant)).toEqual(['balanced','compact','daylight']);expect(choices.notes).toEqual([]);
  const dimensions=choices.alternatives.map(option=>`${option.result.footprint.width}×${option.result.footprint.depth}`);expect(new Set(dimensions).size).toBe(3);
  for(const option of choices.alternatives){expect(option.proposal.layout!.rooms).toEqual(rooms);expect(()=>applyProposal(source,option.proposal)).not.toThrow();}
 });
});
