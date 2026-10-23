import {describe,expect,it} from 'vitest';
import {createBlankProject} from '../src/domain/seed';
import {previewLayout} from '../src/domain/layout';
import {applyProposal} from '../src/domain/transactions';
import {aiOutputSchema,copilotRequestSchema} from '../src/domain/schema';
import type {AiProposal,LayoutProposal,Project} from '../src/domain/types';

function layout(project:Project,footprintId:string|null=null):LayoutProposal {
  return {levelId:project.levels[0].id,footprintId,width:null,depth:null,idPrefix:'ai-layout-test',baselineVersion:project.version,rooms:[
    {key:'living',name:'Living room',use:'living',area:null,attachedTo:null},
    {key:'bedroom',name:'Bedroom',use:'bedroom',area:null,attachedTo:null},
    {key:'ensuite',name:'Attached bathroom',use:'bathroom',area:null,attachedTo:'bedroom'},
    {key:'bath',name:'Common bathroom',use:'bathroom',area:null,attachedTo:null},
  ]};
}
function proposal(project:Project,footprintId:string|null=null):AiProposal {
  const spec=layout(project,footprintId),preview=previewLayout(project,spec);
  expect(preview.issues).toEqual([]);
  return {id:spec.idPrefix,prompt:'Create a house layout',summary:'Proposed house layout',kind:'layout',changes:[],issues:preview.assumptions,selectedIds:footprintId?[footprintId]:[],model:'fixture',createdAt:new Date().toISOString(),layout:spec,creations:preview.elements.map(after=>({elementId:after.id,before:null,after}))};
}

describe('reviewed new-layout transactions',()=>{
  it('keeps the source untouched during preview and commits the complete hosted set as one revision',()=>{
    const project=createBlankProject('House'),original=structuredClone(project),p=proposal(project);
    expect(project).toEqual(original);expect(p.creations!.length).toBeGreaterThan(10);
    const next=applyProposal(project,p);
    expect(next.version).toBe(project.version+1);
    expect(next.audit[0].affectedIds).toEqual(p.creations!.map(c=>c.elementId));
    expect(next.elements.map(e=>e.id)).toEqual(p.creations!.map(c=>c.elementId));
    for(const element of next.elements){if(element.hostId)expect(next.elements.find(e=>e.id===element.hostId)?.kind).toBe('wall');expect(element.externalId).toBeUndefined();}
    next.elements[0].properties.status='Detached result';
    expect(project).toEqual(original);
  });

  it('retains a selected slab and rejects footprint edits made after preview',()=>{
    const project=createBlankProject('Slab house');project.elements=[{id:'footprint',kind:'slab',name:'Selected boundary',levelId:project.levels[0].id,typeId:'slab-concrete',material:'Reinforced concrete',x:5,y:8,z:-.18,width:16,depth:20,height:.18,rotation:30,editable:true,properties:{}}];
    const original=structuredClone(project),p=proposal(project,'footprint'),next=applyProposal(project,p);
    expect(next.elements.find(e=>e.id==='footprint')).toEqual(original.elements[0]);
    expect(next.elements.filter(e=>e.kind==='slab')).toHaveLength(1);
    project.elements[0].width-=.1;
    expect(()=>applyProposal(project,p)).toThrow(/diff|stale|changed/i);
  });

  it('rejects a stale revision and cannot apply the same layout twice',()=>{
    const project=createBlankProject('House'),p=proposal(project),next=applyProposal(project,p);
    expect(()=>applyProposal({...project,version:project.version+1},p)).toThrow(/changed after/i);
    expect(()=>applyProposal(next,p)).toThrow(/changed after/i);
  });

  it('rejects changed, omitted and duplicated creation diffs atomically',()=>{
    const project=createBlankProject('House'),p=proposal(project),original=structuredClone(project);
    const tampered=structuredClone(p);tampered.creations![0].after.width+=1;
    expect(()=>applyProposal(project,tampered)).toThrow(/diff/i);
    const incomplete=structuredClone(p);incomplete.creations!.pop();
    expect(()=>applyProposal(project,incomplete)).toThrow(/incomplete/i);
    const duplicated=structuredClone(p);duplicated.creations![1]=structuredClone(duplicated.creations![0]);
    expect(()=>applyProposal(project,duplicated)).toThrow(/duplicate/i);
    expect(project).toEqual(original);
  });

  it('enforces selection, identity-prefix and operation boundaries',()=>{
    const project=createBlankProject('House'),p=proposal(project);
    expect(()=>applyProposal(project,{...p,selectedIds:['unrelated']})).toThrow(/selected slab/i);
    expect(()=>applyProposal(project,{...p,layout:{...p.layout!,idPrefix:'different'}})).toThrow(/specification/i);
    expect(()=>applyProposal(project,{...p,crewCount:2})).toThrow(/separately/i);
    expect(()=>applyProposal(project,{...p,kind:'analysis'})).toThrow(/mixed/i);
    expect(()=>applyProposal(project,{...p,summary:'x'.repeat(3000)})).toThrow(/metadata/i);
    const forged={...p,layout:{...p.layout!,deleteSource:true}};
    expect(()=>applyProposal(project,forged)).toThrow(/specification/i);
  });

  it('rechecks constraints and approved types at acceptance rather than trusting the preview',()=>{
    const project=createBlankProject('House'),p=proposal(project);
    project.constraints.lockedProperties=['geometry'];expect(()=>applyProposal(project,p)).toThrow(/locked/i);
    project.constraints.lockedProperties=[];project.types.filter(t=>t.kind==='door').forEach(t=>t.approved=false);
    expect(()=>applyProposal(project,p)).toThrow(/approved|type/i);
  });

  it('rejects raw AI geometry and malformed layout programs at the schema boundary',()=>{
    const project=createBlankProject('House'),spec=layout(project);const {idPrefix:_,baselineVersion:__,...input}=spec;
    expect(aiOutputSchema.safeParse({summary:'New layout',issues:[],operations:[{action:'create-layout',layout:input}]}).success).toBe(true);
    expect(aiOutputSchema.safeParse({summary:'New layout',issues:[],operations:[{action:'create-layout',layout:{...input,elements:[]}}]}).success).toBe(false);
    expect(aiOutputSchema.safeParse({summary:'New layout',issues:[],operations:[{action:'create-layout',layout:{...input,rooms:[{...input.rooms[0],area:Infinity}]}}]}).success).toBe(false);
    expect(copilotRequestSchema.safeParse({prompt:'Create house',selectedIds:[],project,activeLevelId:project.levels[0].id}).success).toBe(true);
  });
});
