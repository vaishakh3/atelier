import {describe,expect,it,vi} from 'vitest';
import * as layoutEngine from '../src/domain/layout';
import {createBlankProject} from '../src/domain/seed';
import {previewLayout} from '../src/domain/layout';
import {applyProposal} from '../src/domain/transactions';
import {aiOutputSchema,copilotRequestSchema} from '../src/domain/schema';
import type {AiProposal,BimElement,LayoutProposal,Project} from '../src/domain/types';

function layout(project:Project,footprintId:string|null=null):LayoutProposal {
  return {levelId:project.levels[0].id,footprintId,width:null,depth:null,idPrefix:'ai-layout-test',baselineVersion:project.version,rooms:[
    {key:'living',name:'Living room',use:'living',area:null,attachedTo:null},
    {key:'bedroom',name:'Bedroom',use:'bedroom',area:null,attachedTo:null},
    {key:'ensuite',name:'Attached bathroom',use:'bathroom',area:null,attachedTo:'bedroom'},
    {key:'bath',name:'Common bathroom',use:'bathroom',area:null,attachedTo:null},
  ]};
}
function proposal(project:Project,footprintId:string|null=null,overrides:Partial<LayoutProposal>={}):AiProposal {
  const spec={...layout(project,footprintId),...overrides},preview=previewLayout(project,spec);
  expect(preview.issues).toEqual([]);
  return {id:spec.idPrefix,prompt:'Create a house layout',summary:'Proposed house layout',kind:'layout',changes:[],issues:preview.assumptions,selectedIds:footprintId?[footprintId]:[],model:'fixture',createdAt:new Date().toISOString(),layout:spec,creations:preview.elements.map(after=>({elementId:after.id,before:null,after})),levelCreations:preview.levels.map(after=>({levelId:after.id,before:null,after})),removals:preview.removedElements.map(before=>({elementId:before.id,before,after:null}))};
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

  it('retains bounded resize provenance without bypassing reviewed geometry validation',()=>{
    const project=createBlankProject('Resize context'),rooms=layout(project).rooms.map(room=>room.key==='bedroom'?{...room,area:18}:room),p=proposal(project,null,{rooms});
    p.roomResize={roomKey:'bedroom',roomName:'Bedroom',sourceArea:15,targetArea:18};
    expect(applyProposal(project,p).elements).toHaveLength(p.creations!.length);
    for(const roomResize of [{...p.roomResize,targetArea:19},{...p.roomResize,sourceArea:NaN},{...p.roomResize,sourceArea:0},{...p.roomResize,roomKey:'missing'},{...p.roomResize,hidden:true}])expect(()=>applyProposal(project,{...p,roomResize})).toThrow(/resize context/i);
    expect(()=>applyProposal(project,{...p,kind:'analysis'})).toThrow(/resize context/i);
    const changed=structuredClone(p);changed.creations![0].after.width+=1;
    expect(()=>applyProposal(project,changed)).toThrow(/diff/i);
    expect(project.elements).toEqual([]);
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


describe('atomic two-storey concept transactions and bounded replanning',()=>{
  const twoStoreys=(project:Project):Partial<LayoutProposal>=>({storeys:2,floorHeight:3.4,rooms:layout(project).rooms.map(room=>({...room,floor:room.use==='bedroom'||room.attachedTo!==null?1 as const:0 as const}))});

  it('accepts a new upper level, coordinated geometry and ground/upper room wishes in one revision',()=>{
    const project=createBlankProject('Two floors'),before=structuredClone(project),p=proposal(project,null,twoStoreys(project));
    expect(project).toEqual(before);expect(p.levelCreations).toHaveLength(1);expect(p.removals).toEqual([]);
    const upper=p.levelCreations![0].after;expect(upper.elevation).toBeCloseTo(project.levels[0].elevation+3.4);
    const next=applyProposal(project,p);expect(next.version).toBe(before.version+1);expect(next.audit).toHaveLength(before.audit.length+1);expect(next.levels).toEqual([...before.levels,upper]);
    expect(next.elements.some(element=>element.kind==='stair')).toBe(true);
    for(const room of next.elements.filter(element=>element.kind==='room'&&['bedroom','ensuite'].includes(String(element.properties.layoutKey))))expect(room.levelId).toBe(upper.id);
    for(const opening of next.elements.filter(element=>element.kind==='door'||element.kind==='window'))expect(next.elements.find(element=>element.id===opening.hostId)?.levelId).toBe(opening.levelId);
    expect(new Set(next.audit[0].affectedIds)).toEqual(new Set([...p.creations!.map(item=>item.elementId),upper.id]));
    expect(next.schedule).toEqual(before.schedule);expect(next.types).toEqual(before.types);expect(project).toEqual(before);
  });

  it('rejects hidden, tampered, missing and extra level or upper element diffs without partial acceptance',()=>{
    const project=createBlankProject('Two floors'),p=proposal(project,null,twoStoreys(project)),before=structuredClone(project);
    const omitted=structuredClone(p);delete omitted.levelCreations;expect(()=>applyProposal(project,omitted)).toThrow(/incomplete/);
    const changed=structuredClone(p);changed.levelCreations![0].after.elevation+=.1;expect(()=>applyProposal(project,changed)).toThrow(/level diff/);
    const renamed=structuredClone(p);renamed.levelCreations![0].after.name='Unreviewed name';expect(()=>applyProposal(project,renamed)).toThrow(/level diff/);
    const extra=structuredClone(p);extra.levelCreations!.push({...structuredClone(extra.levelCreations![0]),levelId:'hidden-level'});expect(()=>applyProposal(project,extra)).toThrow(/invalid|incomplete/);
    const unknown=structuredClone(p);unknown.creations!.find(item=>item.after.levelId===p.levelCreations![0].levelId)!.after.levelId='unreviewed-level';expect(()=>applyProposal(project,unknown)).toThrow(/diff/);
    expect(()=>applyProposal(project,{...p,kind:'analysis'})).toThrow(/mixed/);expect(project).toEqual(before);
  });

  it('rechecks level locks and stair component approvals at acceptance',()=>{
    const project=createBlankProject('Two floors'),p=proposal(project,null,twoStoreys(project)),upper=p.levelCreations![0].levelId;
    for(const lock of ['levels','levels.*','model.levels','levels.elevation','levels.name',`${upper}.elevation`,`levels.${upper}.name`])expect(()=>applyProposal({...project,constraints:{...project.constraints,lockedProperties:[lock]}},p)).toThrow(/locked/i);
    project.types.find(type=>type.kind==='stair')!.approved=false;expect(()=>applyProposal(project,p)).toThrow(/approved|type/i);
  });

  it('replaces only the reviewed concept set while keeping a selected slab and unrelated manual geometry',()=>{
    const initial=createBlankProject('Replan'),created=applyProposal(initial,proposal(initial)),slab=created.elements.find(element=>element.kind==='slab')!;
    const manual={...structuredClone(slab),id:'manual-retained',x:200,y:200,properties:{status:'Manual model'},name:'Authored manual slab'};created.elements.push(manual);
    const original=structuredClone(created),p=proposal(created,slab.id,{idPrefix:'ai-concept-replan',replaceConcept:true}),next=applyProposal(created,p);
    expect(p.removals!.length).toBeGreaterThan(0);expect(p.removals!.every(removal=>removal.before.properties.conceptLayout===true&&removal.elementId!==slab.id&&removal.elementId!==manual.id)).toBe(true);
    expect(next.elements.find(element=>element.id===slab.id)).toEqual(slab);expect(next.elements.find(element=>element.id===manual.id)).toEqual(manual);
    expect(p.removals!.every(removal=>!next.elements.some(element=>element.id===removal.elementId))).toBe(true);expect(next.version).toBe(original.version+1);expect(created).toEqual(original);
    expect(()=>applyProposal(created,{...p,layout:{...p.layout!,replaceConcept:false}})).toThrow();
  });

  it('checks complete removal snapshots, rejects duplicate removals and preserves locks/external IDs',()=>{
    const first=createBlankProject('Replan'),project=applyProposal(first,proposal(first)),slab=project.elements.find(element=>element.kind==='slab')!,p=proposal(project,slab.id,{idPrefix:'ai-reviewed-replan',replaceConcept:true}),original=structuredClone(project);
    const stale=structuredClone(project),source=stale.elements.find(element=>element.id===p.removals![0].elementId)!;source.properties.reviewNote='New authored specification';expect(()=>applyProposal(stale,p)).toThrow(/diff|stale/i);
    const changed=structuredClone(p);changed.removals![0].before.material='Forged material';expect(()=>applyProposal(project,changed)).toThrow(/diff|stale/i);
    const duplicate=structuredClone(p);duplicate.removals![1]=structuredClone(duplicate.removals![0]);expect(()=>applyProposal(project,duplicate)).toThrow(/duplicate/i);
    const locked=structuredClone(project);locked.constraints.lockedElementIds=[p.removals![0].elementId];expect(()=>applyProposal(locked,p)).toThrow(/locked/i);
    const propertyLock=structuredClone(project);propertyLock.constraints.lockedProperties=['name'];expect(()=>applyProposal(propertyLock,p)).toThrow(/locked/i);
    const imported=structuredClone(project);imported.elements.find(element=>element.id===p.removals![0].elementId)!.externalId='external-ifc-guid';expect(()=>applyProposal(imported,p)).toThrow();
    expect(project).toEqual(original);
  });

  it('blocks manual upper geometry and rejects a reused generation prefix or stale replan revision',()=>{
    const first=createBlankProject('Replan'),project=applyProposal(first,proposal(first)),slab=project.elements.find(element=>element.kind==='slab')!;
    expect(previewLayout(project,{...layout(project,slab.id),replaceConcept:true}).issues.join(' ')).toMatch(/identifier already exists/i);
    const p=proposal(project,slab.id,{idPrefix:'ai-new-generation',replaceConcept:true});expect(()=>applyProposal({...project,version:project.version+1},p)).toThrow(/changed after/);
    const upperLevel={id:'manual-upper',name:'Manual upper level',elevation:3.4};project.levels.push(upperLevel);project.elements.push({...structuredClone(slab),id:'manual-upper-blocker',levelId:upperLevel.id,z:3.2,properties:{},name:'Manual upper slab'});
    const request={...layout(project,slab.id),...twoStoreys(project),idPrefix:'ai-upper-replan',replaceConcept:true};expect(previewLayout(project,request).issues.length).toBeGreaterThan(0);
  });

  it('independently rejects an engine-proposed removal outside the original house boundary',()=>{
    const blank=createBlankProject('Bounded replacement'),project=applyProposal(blank,proposal(blank)),spec={...layout(project),idPrefix:'ai-bounded-replan',replaceConcept:true},derived=previewLayout(project,spec),before=structuredClone(project);
    expect(derived.issues).toEqual([]);const source=project.elements.find(element=>element.kind==='wall')!,farCopy={...structuredClone(source),id:'unrelated-copied-wall',x:source.x+500,name:'Distant copied wall'};project.elements.push(farCopy);
    const compromised={...derived,removedElements:[...derived.removedElements,farCopy]},p:AiProposal={id:spec.idPrefix,prompt:'Replan this house',summary:'Bounded replan',kind:'layout',changes:[],issues:[],selectedIds:[],model:'fixture',createdAt:new Date().toISOString(),layout:spec,creations:derived.elements.map(after=>({elementId:after.id,before:null,after})),levelCreations:derived.levels.map(after=>({levelId:after.id,before:null,after})),removals:compromised.removedElements.map(before=>({elementId:before.id,before,after:null}))};
    const spy=vi.spyOn(layoutEngine,'previewLayout').mockReturnValue(compromised);
    try{expect(()=>applyProposal(project,p)).toThrow(/outside the original house footprint/);}finally{spy.mockRestore();}
    expect(project.elements).toEqual([...before.elements,farCopy]);expect(project.version).toBe(before.version);
  });

  it('independently protects intersecting foreign-level solids while allowing remote, touching and semantic geometry',()=>{
    const blank=createBlankProject('Mezzanine protection'),spec={...layout(blank),...twoStoreys(blank)},derived=previewLayout(blank,spec),p=proposal(blank,null,twoStoreys(blank));
    expect(derived.issues).toEqual([]);
    const wall=derived.elements.find(element=>element.kind==='wall'&&element.levelId===blank.levels[0].id)!,top=Math.max(...derived.elements.filter(element=>['wall','slab','stair','roof'].includes(element.kind)).map(element=>element.z+element.height));
    const obstruction={...structuredClone(wall),id:'retained-mezzanine',name:'Authored mezzanine',kind:'slab' as const,typeId:'slab-concrete',material:'Reinforced concrete',levelId:'mezzanine',z:1.5,height:.2,properties:{}};
    const withObstruction=(patch:Partial<BimElement>={}):Project=>({...structuredClone(blank),levels:[...blank.levels,{id:'mezzanine',name:'Mezzanine',elevation:1.5}],elements:[{...structuredClone(obstruction),...patch}]});
    // A compromised or regressed preview must not bypass the acceptance boundary.
    const spy=vi.spyOn(layoutEngine,'previewLayout').mockReturnValue(derived);
    try{
      const conflicting=withObstruction(),before=structuredClone(conflicting);
      expect(()=>applyProposal(conflicting,p)).toThrow(/physical geometry on another building level/);
      expect(()=>applyProposal(withObstruction({rotation:wall.rotation+20}),p)).toThrow(/physical geometry on another building level/);
      expect(conflicting).toEqual(before);
      // The rotated corner has overlapping axis-aligned bounds but no real XY intersection.
      const rotatedCorner={x:derived.footprint.x+derived.footprint.width+.05,y:derived.footprint.y+derived.footprint.depth-.02,width:1,depth:.2,rotation:45};
      for(const patch of [{x:wall.x+100},{z:top+100},{z:top},{x:wall.x+wall.width,rotation:wall.rotation},rotatedCorner,{kind:'room' as const,typeId:'room-space',material:'Space'}]){
        const project=withObstruction(patch),next=applyProposal(project,p);
        expect(next.elements.find(element=>element.id===obstruction.id)).toEqual(project.elements[0]);
        expect(next.version).toBe(project.version+1);
      }
    }finally{spy.mockRestore();}
  });

  it('keeps old programs valid while rejecting unsupported floor and storey values',()=>{
    const project=createBlankProject('Schema'),spec=layout(project);const {idPrefix:_,baselineVersion:__,...old}=spec;
    const output=(value:unknown)=>aiOutputSchema.safeParse({summary:'Layout',issues:[],operations:[{action:'create-layout',layout:value}]}).success;
    expect(output(old)).toBe(true);expect(output({...old,storeys:null,floorHeight:null,replaceConcept:null,rooms:old.rooms.map(room=>({...room,floor:null}))})).toBe(true);
    for(const patch of [{storeys:3},{floorHeight:2.9},{floorHeight:4.1},{replaceConcept:'yes'},{rooms:[{...old.rooms[0],floor:2}]}])expect(output({...old,...patch})).toBe(false);
  });
});
