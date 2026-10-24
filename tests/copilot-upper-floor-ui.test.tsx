// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import InspectorCopilot from '../src/components/InspectorCopilot';
import {createBlankProject} from '../src/domain/seed';
import {previewLayout} from '../src/domain/layout';
import {previewUpperFloor} from '../src/domain/upperFloor';
import {applyProposal} from '../src/domain/transactions';
import type {AiProposal,Project,UpperFloorProposal,LayoutRoom} from '../src/domain/types';
import type {CopilotTurn} from '../src/domain/copilotConversation';
const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
function fixture(){
 const project=createBlankProject('Upper floor review'),rooms:LayoutRoom[]=Array.from({length:5},(_,index)=>[{key:`bed-${index+1}`,name:`Existing bedroom ${index+1}`,use:'bedroom' as const,area:14,attachedTo:null},{key:`bath-${index+1}`,name:`Existing bathroom ${index+1}`,use:'bathroom' as const,area:4.5,attachedTo:`bed-${index+1}`}]).flat();rooms.push({key:'living',name:'Living',use:'living',area:20,attachedTo:null},{key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null});
 const layout=previewLayout(project,{levelId:project.levels[0].id,footprintId:null,width:null,depth:null,storeys:2,floorHeight:3.8,replaceConcept:false,variant:'balanced',idPrefix:'existing-house',rooms});
 expect(layout.issues).toEqual([]);project.elements=layout.elements;project.levels.push(...layout.levels);return project;
}
function floorProposal(project:Project):AiProposal{
 const upperFloor:UpperFloorProposal={baseLevelId:project.levels.at(-1)!.id,baselineVersion:project.version,idPrefix:'upper-ui-turn',floorHeight:3.8,rooms:[{key:'upper-bed',name:'New upper bedroom',use:'bedroom',area:14,attachedTo:null},{key:'upper-bath',name:'New upper bathroom',use:'bathroom',area:4.5,attachedTo:'upper-bed'},{key:'study',name:'Upper study',use:'study',area:12,attachedTo:null}]},draft=previewUpperFloor(project,upperFloor);expect(draft.issues).toEqual([]);
 return{id:upperFloor.idPrefix,prompt:'Add an upper floor, preserving the existing ground floor',summary:'Add a bedroom, attached bathroom and study upstairs',kind:'edit',model:'Upper-floor planning engine',createdAt:'2026-10-24T16:00:00Z',selectedIds:[],changes:draft.changes,creations:draft.creations,removals:draft.removals,levelCreations:draft.levelCreations,issues:draft.notes,upperFloor};
}
function props(project:Project){return{project,selectedIds:[],onSelect:vi.fn(),onUpdate:vi.fn(),onDelete:vi.fn(),commit:vi.fn(),notify:vi.fn(),aiReady:true,role:'admin' as const,activeLevelId:project.levels.at(-1)!.id};}
function api(project:Project,proposal:AiProposal,initial:CopilotTurn[]=[]){
 let turns=initial;const calls=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/usage')return json({ok:true});
  if(url==='/api/copilot'){turns=[{id:proposal.id,prompt:proposal.prompt,summary:proposal.summary,kind:proposal.kind,issues:proposal.issues,selectedIds:proposal.selectedIds,status:'proposed',projectVersion:project.version,createdAt:proposal.createdAt,upperFloor:proposal.upperFloor}];return json({...proposal,conversationTurnId:proposal.id});}
  if(init?.method==='PATCH')turns=turns.map(turn=>({...turn,status:JSON.parse(String(init.body)).status}));
  return json({conversation:{projectId:project.id,turns}});
 });vi.stubGlobal('fetch',calls);return calls;
}
function send(){fireEvent.change(screen.getByRole('textbox',{name:'Ask the BIM copilot'}),{target:{value:'Add the requested upper floor, keep the existing house'}});fireEvent.click(screen.getByRole('button',{name:'Send copilot request'}));}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('upper floor addition review',()=>{
 it('shows a separate upper floor plan and exact retained scope without whole-house alternatives',async()=>{
  const project=fixture(),before=structuredClone(project),proposal=floorProposal(project),base=props(project);api(project,proposal);render(<InspectorCopilot {...base}/>);send();
  const review=await screen.findByRole('region',{name:'Add upper floor review'});expect(screen.getByText('Add upper floor',{exact:true})).toBeTruthy();expect(screen.queryByRole('region',{name:'Design alternatives'})).toBeNull();expect(screen.queryByRole('region',{name:'Local plan edit review'})).toBeNull();expect(screen.queryByText('House layout preview')).toBeNull();
  const plan=within(review).getByRole('img',{name:'Proposed upper floor plan'}),createdRoom=proposal.creations!.find(item=>item.after.kind==='room'&&item.after.name==='New upper bedroom')!;expect(plan.querySelector(`[data-element-id="${createdRoom.elementId}"]`)).toBeTruthy();expect(plan.getAttribute('viewBox')).not.toMatch(/NaN|Infinity/);
  const preview=applyProposal(project,proposal),retained=project.elements.filter(element=>JSON.stringify(element)===JSON.stringify(preview.elements.find(item=>item.id===element.id))).length;expect(within(review).getByText(`${retained} of ${project.elements.length} existing elements unchanged. 2 of 2 existing levels unchanged.`)).toBeTruthy();expect(within(review).getByRole('table',{name:'New upper floor spaces'}).textContent).toContain('Upper study');expect(within(review).getByText('Stair access & existing building')).toBeTruthy();expect(screen.getByText(/Structural capacity, foundations/)).toBeTruthy();expect(base.commit).not.toHaveBeenCalled();expect(project).toEqual(before);
 });
 it('lists every existing-building exception and addition before rejecting without a model change',async()=>{
  const project=fixture(),before=structuredClone(project),proposal=floorProposal(project),base=props(project);api(project,proposal);render(<InspectorCopilot {...base}/>);send();await screen.findByRole('button',{name:'Accept upper floor'});fireEvent.click(screen.getByRole('button',{name:'Review upper floor & affected elements'}));
  const dialog=screen.getByRole('dialog',{name:'Review upper floor addition'});for(const [label,items] of [['Modified existing elements',proposal.changes],['Removed existing elements',proposal.removals!],['Added elements',proposal.creations!]]as const){const group=within(dialog).getByRole('region',{name:label});expect(within(group).queryAllByRole('listitem')).toHaveLength(items.length);for(const item of items)expect(group.textContent).toContain(item.elementId);}
  fireEvent.click(within(dialog).getByRole('button',{name:'Reject upper floor'}));await screen.findByText('Proposal rejected. Your project is unchanged.');expect(base.commit).not.toHaveBeenCalled();expect(project).toEqual(before);
 });
 it('accepts one complete transaction, retains unrelated source IDs and records the original turn',async()=>{
  const project=fixture(),before=structuredClone(project),proposal=floorProposal(project),base=props(project),calls=api(project,proposal),onApplied=vi.fn();render(<InspectorCopilot {...base} onApplied={onApplied}/>);send();await screen.findByRole('button',{name:'Accept upper floor'});fireEvent.click(screen.getByRole('button',{name:'Accept upper floor'}));
  expect(base.commit).toHaveBeenCalledOnce();const [next,,ids]=base.commit.mock.calls[0]as unknown as[Project,string,string[]];expect(next.elements).toEqual(applyProposal(project,proposal).elements);expect(next.levels).toHaveLength(before.levels.length+1);expect(next.version).toBe(before.version+1);expect(next.audit).toHaveLength(before.audit.length+1);for(const element of before.elements.filter(item=>item.kind!=='roof'))expect(next.elements.find(item=>item.id===element.id)).toEqual(element);expect(ids).toContain(proposal.levelCreations![0].levelId);expect(onApplied).toHaveBeenCalledWith(proposal);expect(project).toEqual(before);
  await waitFor(()=>expect(calls.mock.calls.some(([url,init])=>url.split('?')[0].endsWith('/turns/upper-ui-turn')&&init?.method==='PATCH'&&JSON.parse(String(init.body)).status==='applied')).toBe(true));expect(screen.queryByRole('button',{name:'Accept upper floor'})).toBeNull();
 });
 it('retains a stale preview for inspection, blocks acceptance and allows rejection',async()=>{
  const project=fixture(),proposal=floorProposal(project),base=props(project);api(project,proposal);const view=render(<InspectorCopilot {...base}/>);send();await screen.findByRole('button',{name:'Accept upper floor'});view.rerender(<InspectorCopilot {...base} project={{...project,version:project.version+1}}/>);expect(screen.getByRole('button',{name:'Accept upper floor'}).hasAttribute('disabled')).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Review upper floor & affected elements'}));const dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('button',{name:'Accept upper floor'}).hasAttribute('disabled')).toBe(true);expect(within(dialog).getByRole('button',{name:'Reject upper floor'}).hasAttribute('disabled')).toBe(false);fireEvent.click(within(dialog).getByRole('button',{name:'Reject upper floor'}));expect(base.commit).not.toHaveBeenCalled();
 });
 it('discloses the independently accessed upper floor for a one-storey house while retaining its existing geometry',async()=>{
  const project=createBlankProject('One-storey house'),layout=previewLayout(project,{levelId:project.levels[0].id,footprintId:null,width:14,depth:12,storeys:1,floorHeight:3.8,idPrefix:'one-storey-house',rooms:[{key:'living',name:'Living',use:'living',area:20,attachedTo:null},{key:'bed',name:'Existing bedroom',use:'bedroom',area:14,attachedTo:null},{key:'bath',name:'Bathroom',use:'bathroom',area:4.5,attachedTo:null}]});expect(layout.issues).toEqual([]);project.elements=layout.elements;project.levels.push(...layout.levels);
  const before=structuredClone(project),proposal=floorProposal(project),base=props(project);api(project,proposal);render(<InspectorCopilot {...base}/>);send();const review=await screen.findByRole('region',{name:'Add upper floor review'});expect(within(review).getByText('External stair access proposed.')).toBeTruthy();expect(within(review).getByText(/no internal staircase connection is proposed/)).toBeTruthy();expect(within(review).getByRole('list',{name:'Proposed stair connections'}).textContent).toContain('Proposed external stair');
  const next=applyProposal(project,proposal);for(const element of before.elements.filter(item=>item.kind!=='roof'))expect(next.elements.find(item=>item.id===element.id)).toEqual(element);expect(next.levels).toHaveLength(2);expect(proposal.creations!.some(item=>item.after.kind==='stair'&&item.after.properties.externalAccess===true)).toBe(true);expect(within(review).getByRole('img',{name:'Proposed upper floor plan'}).querySelector(`[data-element-id="${proposal.creations!.find(item=>item.after.kind==='stair')!.elementId}"]`)).toBeTruthy();expect(base.commit).not.toHaveBeenCalled();expect(project).toEqual(before);
 });
 it('loads the saved upper-floor brief without implying it has already been applied',async()=>{
  const project=fixture(),proposal=floorProposal(project),initial:CopilotTurn={id:proposal.id,prompt:proposal.prompt,summary:proposal.summary,kind:'edit',selectedIds:[],issues:[],status:'proposed',projectVersion:project.version,createdAt:proposal.createdAt,upperFloor:proposal.upperFloor},base=props(project);api(project,proposal,[initial]);render(<InspectorCopilot {...base}/>);await screen.findByText('Pending upper floor addition');fireEvent.click(screen.getByText('Pending upper floor addition'));expect(screen.getByText(/Ask for a fresh upper floor preview before accepting/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Accept upper floor'})).toBeNull();expect(screen.queryByRole('img',{name:'Proposed upper floor plan'})).toBeNull();expect(base.commit).not.toHaveBeenCalled();
 });
});
