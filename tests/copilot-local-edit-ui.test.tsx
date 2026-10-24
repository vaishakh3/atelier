// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import InspectorCopilot from '../src/components/InspectorCopilot';
import {createBlankProject} from '../src/domain/seed';
import {previewLocalRoomEdit} from '../src/domain/localRoomEdit';
import {applyProposal} from '../src/domain/transactions';
import type {AiProposal,BimElement,LocalRoomEditSpec,Project} from '../src/domain/types';
import type {CopilotTurn} from '../src/domain/copilotConversation';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(){
 const project=createBlankProject('Local room review');project.levels.push({id:'upper',name:'Upper floor',elevation:3.2});
 const element=(id:string,kind:BimElement['kind'],x:number,y:number,width:number,depth:number,rotation=0,properties:BimElement['properties']={}):BimElement=>{
  const type=project.types.find(type=>type.kind===kind)!;
  return{id,kind,name:id,levelId:'level-0',typeId:type.id,material:type.material,x,y,z:0,width,depth,height:kind==='room'?.02:kind==='wall'?3:kind==='window'?1.2:kind==='door'?2.1:.2,rotation,editable:true,properties:{conceptLayout:true,conceptGeneration:'house',layoutBaseLevelId:'level-0',layoutStoreys:2,floorIndex:0,...properties}};
 };
 project.elements=[{...element('bed2','room',.2,.2,4,4,0,{layoutKey:'bed2',use:'bedroom',requestedArea:16}),name:'Bedroom 2'},{...element('bed3','room',4.4,.2,4,4,0,{layoutKey:'bed3',use:'bedroom',requestedArea:16}),name:'Bedroom 3'},element('partition','wall',4.4,.2,4,.2,90,{exterior:false}),element('front','wall',0,0,8.6,.2,0,{exterior:true}),element('rear','wall',0,4.2,8.6,.2,0,{exterior:true}),element('west','wall',.2,.2,4,.2,90,{exterior:true}),element('east','wall',8.6,.2,4,.2,90,{exterior:true}),{...element('internal-door','door',4.4,1.2,.9,.2,90,{accessFrom:'bed2',accessTo:'bed3'}),hostId:'partition'},{...element('bed2-door','door',1,0,.9,.2,0,{accessFrom:'outside',accessTo:'bed2'}),hostId:'front'},{...element('bed3-door','door',5.6,0,.9,.2,0,{accessFrom:'outside',accessTo:'bed3'}),hostId:'front'},{...element('bed2-window','window',1,4.2,1.2,.2,0,{roomKey:'bed2'}),hostId:'rear'},{...element('bed3-window','window',5.5,4.2,1.2,.2,0,{roomKey:'bed3'}),hostId:'rear'},element('slab','slab',0,0,8.6,4.4),{...element('upper-room','room',.2,.2,4,4,0,{layoutKey:'upper-bed',use:'bedroom'}),name:'Retained upstairs bedroom',levelId:'upper',z:3.2}];
 return project;
}
function localProposal(project:Project,spec:LocalRoomEditSpec):AiProposal{
 const localEdit={...spec,baselineVersion:project.version,idPrefix:'local-ui-original-turn'},draft=previewLocalRoomEdit(project,localEdit);expect(draft.issues).toEqual([]);
 return{id:localEdit.idPrefix,prompt:'Adjust the requested rooms only',summary:spec.action==='resize-room'?'Resize Bedroom 2 within its local shared boundary':'Replace Bedrooms 2 and 3 with a Study',kind:'edit',model:'Local planning engine',createdAt:'2026-10-24T14:00:00Z',selectedIds:spec.action==='resize-room'?[spec.roomId]:spec.roomIds,changes:draft.changes,creations:draft.creations,removals:draft.removals,issues:draft.notes,localEdit};
}
function props(project:Project){return{project,selectedIds:[],onSelect:vi.fn(),onUpdate:vi.fn(),onDelete:vi.fn(),commit:vi.fn(),notify:vi.fn(),aiReady:true,role:'admin' as const,activeLevelId:project.levels[0].id};}
function api(project:Project,proposal:AiProposal,initial:CopilotTurn[]=[]){
 let turns=initial;const calls=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/usage')return json({ok:true});
  if(url==='/api/copilot'){turns=[{id:proposal.id,prompt:proposal.prompt,summary:proposal.summary,kind:proposal.kind,issues:proposal.issues,selectedIds:proposal.selectedIds,status:'proposed',projectVersion:project.version,createdAt:proposal.createdAt,localEdit:proposal.localEdit}];return json({...proposal,conversationTurnId:proposal.id});}
  if(init?.method==='PATCH'){turns=turns.map(turn=>({...turn,status:JSON.parse(String(init.body)).status}));}
  return json({conversation:{projectId:project.id,turns}});
 });vi.stubGlobal('fetch',calls);return calls;
}
function send(){fireEvent.change(screen.getByRole('textbox',{name:'Ask the BIM copilot'}),{target:{value:'Adjust the requested rooms only'}});fireEvent.click(screen.getByRole('button',{name:'Send copilot request'}));}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('local room edit review',()=>{
 it('shows requested and adjacent room areas with exact bounded scope and no whole-house alternatives',async()=>{
  const project=fixture(),before=structuredClone(project),proposal=localProposal(project,{action:'resize-room',roomId:'bed2',targetArea:19.2}),base=props(project);api(project,proposal);render(<InspectorCopilot {...base}/>);send();
  await screen.findByRole('region',{name:'Local plan edit review'});expect(screen.getByText('Local plan edit',{exact:true})).toBeTruthy();expect(screen.queryByRole('region',{name:'Design alternatives'})).toBeNull();expect(screen.queryByText('House layout preview')).toBeNull();
  const table=screen.getByRole('table',{name:'Affected room areas'}),rows=within(table).getAllByRole('row');expect(rows).toHaveLength(3);expect(rows[1].textContent).toContain('Bedroom 2Requested room16 m²19.2 m²');expect(rows[2].textContent).toContain('Bedroom 3Adjacent room · shared boundary16 m²12.8 m²');expect(table.textContent).not.toContain('Retained upstairs bedroom');
  expect(screen.getByText('modified').textContent).toContain(String(proposal.changes.length));expect(screen.getByText(/existing elements unchanged/)).toBeTruthy();expect(screen.getByText(/Shared boundaries can require/)).toBeTruthy();expect(base.commit).not.toHaveBeenCalled();expect(project).toEqual(before);
  fireEvent.click(screen.getByRole('button',{name:'Before'}));const plan=screen.getByRole('img',{name:'Before local edit · Ground floor'});expect(plan.querySelector('[data-element-id="bed2"]')).toBeTruthy();expect(plan.querySelector('[data-element-id="front"]')).toBeTruthy();expect(plan.getAttribute('viewBox')).not.toMatch(/NaN|Infinity/);
 });

 it('lists every removed room, shared partition and door before accepting a two-room replacement',async()=>{
  const project=fixture(),proposal=localProposal(project,{action:'replace-rooms',roomIds:['bed2','bed3'],name:'Study',use:'study'}),base=props(project);api(project,proposal);render(<InspectorCopilot {...base}/>);send();await screen.findByRole('button',{name:'Accept local edit'});
  fireEvent.click(screen.getByRole('button',{name:'Review local edit & affected elements'}));const dialog=screen.getByRole('dialog',{name:'Review local plan edit'}),removed=within(dialog).getByRole('region',{name:'Removed elements'});
  expect(within(removed).getAllByRole('listitem')).toHaveLength(proposal.removals!.length);expect(removed.textContent).toContain('Bedroom 3');expect(removed.textContent).toContain('partition');expect(removed.textContent).toContain('internal-door');expect(within(dialog).getByRole('region',{name:'Added elements'}).textContent).toContain('No elements in this category');
  const table=within(dialog).getByRole('table',{name:'Affected room areas'});expect(table.textContent).toContain('Study');expect(table.textContent).toContain('32.8 m²');expect(table.textContent).toContain('Removed');expect(within(dialog).getByRole('img',{name:'After local edit · Ground floor'})).toBeTruthy();expect(screen.queryByRole('region',{name:'Design alternatives'})).toBeNull();
  fireEvent.click(within(dialog).getByRole('button',{name:'Reject local edit'}));await screen.findByText('Proposal rejected. Your project is unchanged.');expect(base.commit).not.toHaveBeenCalled();expect(project.elements.find(element=>element.id==='bed3')?.name).toBe('Bedroom 3');
 });

 it('accepts precisely the reviewed neighborhood once and records the original turn outcome',async()=>{
  const project=fixture(),before=structuredClone(project),proposal=localProposal(project,{action:'replace-rooms',roomIds:['bed2','bed3'],name:'Study',use:'study'}),base=props(project),calls=api(project,proposal),onApplied=vi.fn();render(<InspectorCopilot {...base} onApplied={onApplied}/>);send();await screen.findByRole('button',{name:'Accept local edit'});
  fireEvent.click(screen.getByRole('button',{name:'Accept local edit'}));expect(base.commit).toHaveBeenCalledOnce();const [next,,ids]=base.commit.mock.calls[0]as unknown as[Project,string,string[]],affected=new Set([...proposal.changes.map(change=>change.elementId),...proposal.removals!.map(item=>item.elementId),...proposal.creations!.map(item=>item.elementId)]);
  expect(next.elements).toEqual(applyProposal(project,proposal).elements);expect(next.audit).toHaveLength(before.audit.length+1);expect(next.version).toBe(before.version+1);expect(new Set(ids)).toEqual(affected);expect(next.levels).toEqual(before.levels);for(const element of before.elements)if(!affected.has(element.id))expect(next.elements.find(item=>item.id===element.id)).toEqual(element);expect(next.elements.find(element=>element.id==='upper-room')).toEqual(before.elements.find(element=>element.id==='upper-room'));expect(project).toEqual(before);expect(onApplied).toHaveBeenCalledWith(proposal);
  await waitFor(()=>expect(calls.mock.calls.some(([url,init])=>url.split('?')[0].endsWith('/turns/local-ui-original-turn')&&init?.method==='PATCH'&&JSON.parse(String(init.body)).status==='applied')).toBe(true));expect(screen.queryByRole('button',{name:'Accept local edit'})).toBeNull();
 });

 it('keeps a stale local preview inspectable, blocks acceptance and still allows rejection',async()=>{
  const project=fixture(),proposal=localProposal(project,{action:'resize-room',roomId:'bed2',targetArea:19.2}),base=props(project);api(project,proposal);const view=render(<InspectorCopilot {...base}/>);send();await screen.findByRole('button',{name:'Accept local edit'});view.rerender(<InspectorCopilot {...base} project={{...project,version:project.version+1}}/>);
  expect(screen.getByRole('button',{name:'Accept local edit'}).hasAttribute('disabled')).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Review local edit & affected elements'}));const dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('button',{name:'Accept local edit'}).hasAttribute('disabled')).toBe(true);expect(within(dialog).getByRole('button',{name:'Reject local edit'}).hasAttribute('disabled')).toBe(false);expect(within(dialog).getByRole('alert').textContent).toMatch(/changed/);fireEvent.click(within(dialog).getByRole('button',{name:'Reject local edit'}));expect(base.commit).not.toHaveBeenCalled();
 });

 it('loads a pending local intent as history without creating an unreviewed replacement layout',async()=>{
  const project=fixture(),proposal=localProposal(project,{action:'resize-room',roomId:'bed2',targetArea:19.2}),initial:CopilotTurn={id:proposal.id,prompt:proposal.prompt,summary:proposal.summary,kind:'edit',selectedIds:proposal.selectedIds,issues:[],status:'proposed',projectVersion:project.version,createdAt:proposal.createdAt,localEdit:proposal.localEdit},base=props(project);api(project,proposal,[initial]);render(<InspectorCopilot {...base}/>);
  await screen.findByText('Pending local edit');fireEvent.click(screen.getByText('Pending local edit'));expect(screen.getByText(/Resize Bedroom 2 to 19.2 m²/)).toBeTruthy();expect(screen.getByText(/Ask for a fresh local preview before accepting/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Accept local edit'})).toBeNull();expect(screen.queryByRole('region',{name:'Design alternatives'})).toBeNull();expect(base.commit).not.toHaveBeenCalled();
 });
});
