import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../src/domain/seed';
import { applyProposal } from '../src/domain/transactions';
import type { AiProposal, BimElement, Project } from '../src/domain/types';

function proposal(project:Project,id:string,after:Partial<BimElement>):AiProposal {
  const element=project.elements.find(e=>e.id===id)!;
  const before=Object.fromEntries(Object.keys(after).map(key=>[key,structuredClone(element[key as keyof BimElement])])) as Partial<BimElement>;
  return{id:'ai-test',prompt:'Update the selected element',summary:'Reviewed revision',kind:'edit',changes:[{elementId:id,before,after}],issues:[],selectedIds:[id],model:'test',createdAt:new Date().toISOString()};
}
function crews(count:number):AiProposal {
  return{id:'ai-crew',prompt:'Evaluate crews',summary:'Add planning capacity',kind:'schedule',changes:[],issues:[],selectedIds:[],model:'test',createdAt:new Date().toISOString(),crewCount:count};
}
function freezeDeep<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freezeDeep);}return value;}

describe('reviewed AI transactions',()=>{
  it('applies an approved matching type as a detached, auditable revision',()=>{
    const project=freezeDeep(createDemoProject());const id='window-n1-00';
    const target=project.types.find(t=>t.id==='window-thermal')!;
    const p=freezeDeep(proposal(project,id,{typeId:target.id,material:target.material}));
    const next=applyProposal(project,p);
    expect(next.elements.find(e=>e.id===id)?.typeId).toBe(target.id);
    expect(project.elements.find(e=>e.id===id)?.typeId).toBe('window-standard');
    expect(next.version).toBe(project.version+1);expect(next.audit[0].affectedIds).toEqual([id]);
    next.elements[0].properties.status='Mutated detached result';
    expect(project.elements[0].properties.status).toBe('Design development');
  });
  it('rejects changes outside the scoped selection and locked or reference elements',()=>{
    const project=createDemoProject();const p=proposal(project,'window-n1-00',{name:'Updated'});
    p.selectedIds=[];expect(()=>applyProposal(project,p)).toThrow(/unselected/);
    p.selectedIds=['window-n1-00'];project.constraints.lockedElementIds=p.selectedIds;
    expect(()=>applyProposal(project,p)).toThrow(/locked/);
    project.constraints.lockedElementIds=[];project.elements.find(e=>e.id===p.selectedIds[0])!.editable=false;
    expect(()=>applyProposal(project,p)).toThrow(/unavailable/);
  });
  it('detects stale before values and requires a before value for every edit',()=>{
    const project=createDemoProject();const p=proposal(project,'window-n1-00',{width:2});
    project.elements.find(e=>e.id==='window-n1-00')!.width=2.5;
    expect(()=>applyProposal(project,p)).toThrow(/changed after/);
    p.changes[0].before={};expect(()=>applyProposal(project,p)).toThrow(/before and after/);
  });
  it('validates all changes atomically before producing a new revision',()=>{
    const project=createDemoProject(),snapshot=JSON.stringify(project);
    const first=proposal(project,'window-n1-00',{name:'Good change'}),second=proposal(project,'window-n2-00',{width:-1});
    first.selectedIds.push('window-n2-00');first.changes.push(second.changes[0]);
    expect(()=>applyProposal(project,first)).toThrow(/dimensions/);
    expect(JSON.stringify(project)).toBe(snapshot);
  });
  it.each(['id','kind','hostId','editable','externalId','levelId']as const)('prevents direct mutation of %s',field=>{
    const project=createDemoProject();const p=proposal(project,'window-n1-00',{[field]:field==='editable'?false:'forged'} as Partial<BimElement>);
    expect(()=>applyProposal(project,p)).toThrow(/cannot modify/);
  });
  it('enforces nested property locks without blocking unchanged office metadata',()=>{
    const project=createDemoProject();const element=project.elements.find(e=>e.id==='room-living')!;
    const p=proposal(project,element.id,{properties:{...element.properties,status:'Coordinated'}});
    project.constraints.lockedProperties=['properties.status'];expect(()=>applyProposal(project,p)).toThrow(/status.*locked/);
    project.constraints.lockedProperties=['properties'];expect(()=>applyProposal(project,p)).toThrow(/properties.*locked/);
    project.constraints.lockedProperties=[];
    const next=applyProposal(project,p).elements.find(e=>e.id===element.id)!;
    expect(next.properties.status).toBe('Coordinated');expect(next.properties.finish).toBe('Oak flooring');
  });
  it('permits only the supported changed specification fields',()=>{
    const project=createDemoProject();const e=project.elements.find(e=>e.id==='room-living')!;
    expect(()=>applyProposal(project,proposal(project,e.id,{properties:{...e.properties,finish:'Different floor'}}))).toThrow(/cannot modify the finish/);
    const unsafe=JSON.parse('{"constructor":"unsafe"}');
    expect(()=>applyProposal(project,proposal(project,e.id,{properties:unsafe}))).toThrow(/invalid property/);
  });
  it.each([NaN,Infinity,-Infinity,0,-1,1001])('rejects invalid width %s',width=>{
    const project=createDemoProject();expect(()=>applyProposal(project,proposal(project,'window-n1-00',{width}))).toThrow();
  });
  it('requires approved type replacements with the correct class and material',()=>{
    const project=createDemoProject();
    expect(()=>applyProposal(project,proposal(project,'window-n1-00',{typeId:'door-timber',material:'Engineered timber'}))).toThrow(/match the element class/);
    expect(()=>applyProposal(project,proposal(project,'window-n1-00',{typeId:'window-thermal'}))).toThrow(/matching material/);
    project.types.find(t=>t.id==='window-thermal')!.approved=false;
    expect(()=>applyProposal(project,proposal(project,'window-n1-00',{typeId:'window-thermal',material:'Thermal-break aluminium'}))).toThrow(/approved/);
  });
  it('checks opening offset, top elevation and alignment against the host',()=>{
    const project=createDemoProject();
    expect(()=>applyProposal(project,proposal(project,'window-n1-00',{x:11}))).toThrow(/wall host/);
    expect(()=>applyProposal(project,proposal(project,'window-n1-00',{z:2.5}))).toThrow(/wall host/);
    expect(()=>applyProposal(project,proposal(project,'window-n1-00',{rotation:90}))).toThrow(/wall host/);
    expect(()=>applyProposal(project,proposal(project,'window-n1-00',{width:2}))).not.toThrow();
  });
  it('rejects AI host geometry changes that could strand unselected openings',()=>{
    const project=createDemoProject();
    expect(()=>applyProposal(project,proposal(project,'wall-n-00',{x:1}))).toThrow(/hosted openings/);
    expect(()=>applyProposal(project,proposal(project,'wall-n-00',{name:'New wall label'}))).not.toThrow();
  });
  it('rejects duplicate changes and unknown proposal fields',()=>{
    const project=createDemoProject(),p=proposal(project,'window-n1-00',{name:'Updated'});
    p.changes.push(structuredClone(p.changes[0]));expect(()=>applyProposal(project,p)).toThrow(/duplicate/);
    const unexpected={...crews(3),silentChanges:[]};expect(()=>applyProposal(project,unexpected)).toThrow(/shape/);
  });
  it('applies crew capacity changes separately from model edits without input mutation',()=>{
    const project=createDemoProject(),next=applyProposal(project,crews(3));
    expect(project.schedule.crews).toBe(2);expect(next.schedule.crews).toBe(3);expect(next.version).toBe(project.version+1);
    const mixed=crews(3);mixed.changes=proposal(project,'window-n1-00',{name:'Changed'}).changes;
    expect(()=>applyProposal(project,mixed)).toThrow(/separately/);
  });
  it.each([0,-1,1.5,5,Infinity,NaN])('rejects crew count %s outside integer capacity',count=>{
    expect(()=>applyProposal(createDemoProject(),crews(count))).toThrow(/capacity/);
  });
  it('enforces schedule locks and keeps analysis read only',()=>{
    const project=createDemoProject();project.constraints.lockedProperties=['schedule.crews'];
    expect(()=>applyProposal(project,crews(3))).toThrow(/locked/);
    const analysis:AiProposal={...crews(3),kind:'analysis'};delete analysis.crewCount;
    const next=applyProposal(project,analysis);expect(next).toEqual(project);expect(next).not.toBe(project);
    analysis.changes=proposal(project,'window-n1-00',{name:'Changed'}).changes;
    expect(()=>applyProposal(project,analysis)).toThrow(/analysis response cannot/);
  });
});
