// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import InspectorCopilot from '../src/components/InspectorCopilot';
import LayoutProposalPreview from '../src/components/LayoutProposalPreview';
import {createBlankProject,createDemoProject} from '../src/domain/seed';
import {previewLayout} from '../src/domain/layout';
import {generateLayoutAlternatives} from '../src/domain/layoutAlternatives';
import {applyProposal} from '../src/domain/transactions';
import {DEFAULT_AI_MODEL} from '../src/domain/aiConfig';
import {num} from '../src/components/ui';
import type {AiProposal,LayoutProposal,Project} from '../src/domain/types';

function layoutProposal(project:Project,selectedIds:string[]=[],patch:Partial<LayoutProposal>={}):AiProposal {
 const spec:LayoutProposal={levelId:project.levels[0].id,footprintId:selectedIds[0]??null,width:null,depth:null,idPrefix:'layout-ui-review',baselineVersion:project.version,rooms:[
  {key:'living',name:'Living room',use:'living',area:20,attachedTo:null},
  {key:'bedroom',name:'Primary bedroom',use:'bedroom',area:14,attachedTo:null},
  {key:'ensuite',name:'Attached bathroom',use:'bathroom',area:4.5,attachedTo:'bedroom'},
  {key:'bath',name:'Common bathroom',use:'bathroom',area:null,attachedTo:null},
 ],...patch};
 const output=previewLayout(project,spec);if(output.issues.length)throw new Error(output.issues.join(' '));
 return{id:spec.idPrefix,prompt:'Create a house layout',summary:'Proposed house with four requested rooms and connected circulation',kind:'layout',changes:[],issues:output.assumptions,selectedIds,model:DEFAULT_AI_MODEL,createdAt:'2026-10-24T12:00:00Z',layout:spec,creations:output.elements.map(after=>({elementId:after.id,before:null,after})),levelCreations:output.levels.map(after=>({levelId:after.id,before:null,after})),removals:output.removedElements.map(before=>({elementId:before.id,before,after:null}))};
}
function response(value:unknown){return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});}
function provider(make=(project:Project,selectedIds:string[])=>layoutProposal(project,selectedIds)){
 const requests:{project:Project;selectedIds:string[];activeLevelId?:string;prompt:string}[]=[];
 const fetch=vi.fn(async(input:string,init?:RequestInit)=>{
  if(input==='/api/usage')return response({ok:true});
  if(input!=='/api/copilot')throw new Error('Unexpected endpoint '+input);
  const body=JSON.parse(String(init?.body));requests.push(body);return response(make(body.project,body.selectedIds));
 });vi.stubGlobal('fetch',fetch);return{requests,fetch};
}
function props(project:Project){return{project,selectedIds:[],onSelect:vi.fn(),onUpdate:vi.fn(),onDelete:vi.fn(),commit:vi.fn(),aiReady:true,role:'admin' as const,notify:vi.fn(),activeLevelId:project.levels[0].id};}
function sendPrompt(value='Create a house layout'){fireEvent.change(screen.getByRole('textbox',{name:'Ask the BIM copilot'}),{target:{value}});fireEvent.click(screen.getByRole('button',{name:'Send copilot request'}));}
function nineRoomProgramme():LayoutProposal['rooms']{return[...Array.from({length:3},(_,index)=>[
 {key:`bed${index}`,name:`Bedroom ${index+1}`,use:'bedroom' as const,area:14,attachedTo:null,floor:0 as const},
 {key:`bath${index}`,name:`Ensuite ${index+1}`,use:'bathroom' as const,area:4.5,attachedTo:`bed${index}`,floor:0 as const},
]).flat(),{key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null,floor:0},{key:'library',name:'Library',use:'study',area:9,attachedTo:null,floor:0},{key:'pool',name:'Indoor pool zone',use:'pool',area:24,attachedTo:null,floor:0}];}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('reviewable copilot house layouts',()=>{
 it('uses the canonical post-save snapshot and revision, then rejects without changing the source',async()=>{
  const original=createBlankProject('House draft'),originalBefore=structuredClone(original),canonical=structuredClone(original);canonical.version++;canonical.audit[0].actor='authenticated-workspace-user';
  let current=original,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),beforeRequest=vi.fn(async()=>{await gate;current=canonical;}),getCurrentProject=vi.fn(()=>structuredClone(current));
  const api=provider(),base=props(original),view=render(<InspectorCopilot {...base} beforeRequest={beforeRequest} getCurrentProject={getCurrentProject}/>);
  expect(screen.getByText('Create a house layout').closest('button')?.disabled).toBe(false);
  fireEvent.click(screen.getByText('Create a house layout'));expect((screen.getByRole('textbox',{name:'Ask the BIM copilot'}) as HTMLTextAreaElement).value).toMatch(/appropriately sized footprint/);
  expect(screen.getByText(/GPT-6.1 Sol/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Send copilot request'}));fireEvent.keyDown(screen.getByRole('textbox',{name:'Ask the BIM copilot'}),{key:'Enter'});
  expect(beforeRequest).toHaveBeenCalledTimes(1);expect(getCurrentProject).not.toHaveBeenCalled();expect(api.requests).toHaveLength(0);
  await act(async()=>{release();await gate;});
  await screen.findByText('House layout preview');
  expect(getCurrentProject).toHaveBeenCalledTimes(1);expect(api.requests).toHaveLength(1);expect(api.requests[0].project).toEqual(canonical);expect(api.requests[0].activeLevelId).toBe(canonical.levels[0].id);
  view.rerender(<InspectorCopilot {...base} project={canonical} beforeRequest={beforeRequest} getCurrentProject={getCurrentProject}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Accept layout'}) as HTMLButtonElement).disabled).toBe(false));
  expect(base.commit).not.toHaveBeenCalled();expect(original).toEqual(originalBefore);expect(canonical.elements).toEqual([]);
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));
  const dialog=screen.getByRole('dialog',{name:'Review proposed house layout'}),output=layoutProposal(canonical);
  expect(within(dialog).getByRole('img',{name:/Proposed house floor plan/})).toBeTruthy();
  const elements=within(dialog).getByRole('table',{name:'Complete proposed creation list'});
  expect(within(elements).getAllByRole('row')).toHaveLength(output.creations!.length+1);
  expect(within(dialog).getByText('Via Primary bedroom')).toBeTruthy();
  const room=output.creations!.find(creation=>creation.after.properties.layoutKey==='bedroom')!.after;
  expect(within(dialog).getByRole('table',{name:'Proposed room dimensions'}).textContent).toContain(`${num(room.width,2)} × ${num(room.depth,2)}`);
  fireEvent.click(within(dialog).getByRole('button',{name:'Reject layout'}));
  expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByText('Proposal rejected. Your project is unchanged.')).toBeTruthy();expect(base.commit).not.toHaveBeenCalled();expect(canonical.elements).toEqual([]);expect(original).toEqual(originalBefore);
 });

 it('accepts the complete hosted geometry exactly once after review and invokes the camera-fit callback',async()=>{
  const project=createBlankProject('Accepted house'),before=structuredClone(project),api=provider(),base=props(project),onApplied=vi.fn();
  const view=render(<InspectorCopilot {...base} onApplied={onApplied} getCurrentProject={()=>structuredClone(project)}/>);sendPrompt();
  await screen.findByText('House layout preview');expect(project).toEqual(before);expect(base.commit).not.toHaveBeenCalled();
  expect(screen.getByText('Construction plan')).toBeTruthy();expect(screen.getByText(/draft days/)).toBeTruthy();expect(screen.getByText(/Accepting geometry leaves construction quantities/)).toBeTruthy();expect(screen.queryByText('0 days')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));const dialog=screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button',{name:'Accept layout'}));
  expect(base.commit).toHaveBeenCalledTimes(1);expect(onApplied).toHaveBeenCalledTimes(1);expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByRole('button',{name:'Accept layout'})).toBeNull();
  const [next,action,ids]=base.commit.mock.calls[0] as unknown as [Project,string,string[]],expected=layoutProposal(api.requests[0].project);
  expect(next.elements).toEqual(expected.creations!.map(creation=>creation.after));expect(next.version).toBe(project.version+1);expect(ids).toEqual(expected.creations!.map(creation=>creation.elementId));expect(action).toMatch(/Accepted AI proposal/);
  for(const opening of next.elements.filter(element=>element.hostId))expect(next.elements.find(element=>element.id===opening.hostId)?.kind).toBe('wall');
  expect(project).toEqual(before);expect(screen.getByText(/Changes applied. You can undo/)).toBeTruthy();
  view.rerender(<InspectorCopilot {...base} project={next} onApplied={onApplied} getCurrentProject={()=>structuredClone(next)}/>);
  expect(screen.getByRole('button',{name:/Improve house layout/})).toBeTruthy();
 });

 it('keeps a changed-model preview visible but disables accepting its stale revision',async()=>{
  const project=createBlankProject('Stale review'),api=provider(),base=props(project),view=render(<InspectorCopilot {...base}/>);sendPrompt();await screen.findByText('House layout preview');
  view.rerender(<InspectorCopilot {...base} project={{...project,version:project.version+1}}/>);
  expect((screen.getByRole('button',{name:'Accept layout'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('img',{name:/Proposed house floor plan/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));expect((within(screen.getByRole('dialog')).getByRole('button',{name:'Accept layout'}) as HTMLButtonElement).disabled).toBe(true);
  expect(base.commit).not.toHaveBeenCalled();expect(api.requests).toHaveLength(1);
 });

 it('keeps design notes compact in both reviews while leaving a real stale-preview blocker visible',async()=>{
  const project=createBlankProject('Notes and blockers'),before=structuredClone(project),base=props(project),notes=['Review room dimensions before detailing.','Review the service route.','Unpriced specialist work is excluded.'];
  provider((source,ids)=>({...layoutProposal(source,ids),issues:notes}));const view=render(<InspectorCopilot {...base}/>);sendPrompt();await screen.findByText('House layout preview');
  const summary=screen.getByText('Design notes & assumptions').closest('summary')!,details=summary.closest('details')!;expect(details.open).toBe(false);expect(summary.textContent).toContain('· 3');expect(screen.queryByRole('alert')).toBeNull();expect(document.querySelector('.proposal .notice.warning')).toBeNull();
  fireEvent.click(summary);expect(within(details).getAllByRole('listitem').map(item=>item.textContent)).toEqual(notes);fireEvent.click(summary);expect(details.open).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));const dialog=screen.getByRole('dialog'),modalSummary=within(dialog).getByText('Design notes & assumptions').closest('summary')!,modalDetails=modalSummary.closest('details')!;
  expect(modalDetails.open).toBe(false);expect(modalSummary.tabIndex).toBe(0);fireEvent.click(modalSummary);expect(within(modalDetails).getAllByRole('listitem').map(item=>item.textContent)).toEqual(notes);expect((within(dialog).getByRole('button',{name:'Accept layout'})as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(within(dialog).getByRole('button',{name:'Close dialog'}));view.rerender(<InspectorCopilot {...base} project={{...project,version:project.version+1}}/>);
  expect(details.open).toBe(false);const alert=screen.getByRole('alert');expect(alert.textContent).toMatch(/project changed/i);expect(alert.querySelector('.notice.warning')).toBeTruthy();expect((screen.getByRole('button',{name:'Accept layout'})as HTMLButtonElement).disabled).toBe(true);expect(base.commit).not.toHaveBeenCalled();expect(project).toEqual(before);
 });

 it('renders a rotated selected-slab proposal with actual feet dimensions and its retained footprint',()=>{
  const source=createBlankProject('Existing footprint');source.units='ft';const type=source.types.find(type=>type.kind==='slab')!;
  source.elements.push({id:'slab-boundary',kind:'slab',name:'Surveyed slab',levelId:source.levels[0].id,typeId:type.id,material:type.material,x:24,y:-7,z:-.2,width:16,depth:20,height:.2,rotation:37,editable:true,properties:{}});
  const before=structuredClone(source),proposal=layoutProposal(source,['slab-boundary']),preview=applyProposal(source,proposal);
  render(<LayoutProposalPreview source={source} preview={preview} proposal={proposal} disabled={false} onAccept={vi.fn()} onReject={vi.fn()}/>);
  expect(screen.getByText(/Selected slab/)).toBeTruthy();expect(screen.getByText(/52.49 ft × 65.62 ft/)).toBeTruthy();
  const room=proposal.creations!.find(creation=>creation.after.properties.layoutKey==='living')!.after;
  expect(screen.getByRole('table',{name:'Proposed room dimensions'}).textContent).toContain(`${num(room.width*3.280839895,2)} × ${num(room.depth*3.280839895,2)}`);
  const svg=screen.getByRole('img',{name:/Proposed house floor plan/});expect(svg.querySelectorAll('polygon').length).toBeGreaterThan(10);expect(svg.getAttribute('viewBox')).not.toMatch(/NaN|Infinity/);
  expect(source).toEqual(before);expect(preview.elements.find(element=>element.id==='slab-boundary')).toEqual(before.elements[0]);
 });

 it('does not allow Enter to bypass reviewer or unavailable-connection restrictions',()=>{
  const project=createBlankProject('Read only'),api=provider(),base=props(project),view=render(<InspectorCopilot {...base} role="reviewer"/>);
  const input=screen.getByRole('textbox',{name:'Ask the BIM copilot'});fireEvent.change(input,{target:{value:'Create a house'}});fireEvent.keyDown(input,{key:'Enter'});
  expect((screen.getByRole('button',{name:'Send copilot request'}) as HTMLButtonElement).disabled).toBe(true);expect(api.fetch).not.toHaveBeenCalled();
  view.rerender(<InspectorCopilot {...base} aiReady={false}/>);fireEvent.keyDown(input,{key:'Enter'});expect(api.fetch).not.toHaveBeenCalled();
 });

 it('cancels a pending pre-request save if the workspace closes',async()=>{
  const project=createBlankProject('Closing workspace'),api=provider(),base=props(project);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),view=render(<InspectorCopilot {...base} beforeRequest={()=>gate}/>);
  sendPrompt();view.unmount();await act(async()=>{release();await gate;});expect(api.fetch).not.toHaveBeenCalled();
 });

 it('switches floor plans, dimensions and room schedules consistently in compact and expanded review',()=>{
  const source=createBlankProject('Two-storey review'),proposal=layoutProposal(source,[],{storeys:2,floorHeight:3.2,rooms:[
   {key:'living',name:'Ground living',use:'living',area:20,attachedTo:null,floor:0},
   {key:'bath',name:'Ground bathroom',use:'bathroom',area:4.5,attachedTo:null,floor:0},
   {key:'bedroom',name:'Upstairs bedroom',use:'bedroom',area:14,attachedTo:null,floor:1},
   {key:'ensuite',name:'Upstairs ensuite',use:'bathroom',area:4.5,attachedTo:'bedroom',floor:1},
  ]}),before=structuredClone(source),preview=applyProposal(source,proposal),upper=proposal.levelCreations![0].after;
  const view=render(<LayoutProposalPreview source={source} preview={preview} proposal={proposal} disabled={false} onAccept={vi.fn()} onReject={vi.fn()}/>);
  const compact=screen.getByRole('tablist',{name:'Proposed layout floors'}),upperTab=within(compact).getByRole('tab',{name:new RegExp(upper.name)});
  expect(within(screen.getByRole('table',{name:'Proposed room dimensions'})).getByText('Ground living')).toBeTruthy();
  expect(within(screen.getByRole('table',{name:'Proposed room dimensions'})).queryByText('Upstairs bedroom')).toBeNull();
  fireEvent.click(upperTab);expect(upperTab.getAttribute('aria-selected')).toBe('true');
  expect(within(screen.getByRole('table',{name:'Proposed room dimensions'})).getByText('Upstairs bedroom')).toBeTruthy();expect(screen.getByRole('img',{name:new RegExp('footprint dimensions · '+upper.name)})).toBeTruthy();
  expect(screen.getByLabelText('New levels to create').textContent).toContain(upper.name);expect(screen.getByLabelText('Proposed stair connections').textContent).toContain(upper.name);
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));const dialog=screen.getByRole('dialog'),fullTabs=within(dialog).getByRole('tablist',{name:'Proposed layout floors'});
  expect(within(fullTabs).getByRole('tab',{name:new RegExp(upper.name)}).getAttribute('aria-selected')).toBe('true');
  const upperRooms=within(dialog).getByRole('table',{name:'Proposed room dimensions'});expect(upperRooms.textContent).toContain('Upstairs bedroom');expect(upperRooms.textContent).not.toContain('Ground living');
  expect(within(dialog).getByText(/not daylight, ventilation/)).toBeTruthy();expect(upperRooms.textContent).toContain('Exterior window');
  fireEvent.keyDown(within(fullTabs).getByRole('tab',{name:new RegExp(upper.name)}),{key:'ArrowLeft'});
  expect(within(dialog).getByRole('table',{name:'Proposed room dimensions'}).textContent).toContain('Ground living');
  fireEvent.click(within(dialog).getByRole('button',{name:'Close dialog'}));
  expect(within(compact).getByRole('tab',{name:new RegExp(source.levels[0].name)}).getAttribute('aria-selected')).toBe('true');expect(source).toEqual(before);
  fireEvent.click(upperTab);const single=layoutProposal(source,[],{idPrefix:'single-after-multi',storeys:1}),singlePreview=applyProposal(source,single);
  view.rerender(<LayoutProposalPreview source={source} preview={singlePreview} proposal={single} disabled={false} onAccept={vi.fn()} onReject={vi.fn()}/>);
  expect(screen.getAllByRole('tab')).toHaveLength(1);expect(screen.getByRole('tab').getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab').id);
 });

 it('shows every replacement before acceptance and makes the exact stored objects inspectable',()=>{
  const blank=createBlankProject('Existing concept'),first=layoutProposal(blank,[],{idPrefix:'original-concept'}),source=applyProposal(blank,first),before=structuredClone(source),proposal=layoutProposal(source,[],{idPrefix:'improved-concept',replaceConcept:true}),preview=applyProposal(source,proposal),onAccept=vi.fn();
  expect(proposal.removals!.length).toBeGreaterThan(0);
  render(<LayoutProposalPreview source={source} preview={preview} proposal={proposal} disabled={false} onAccept={onAccept} onReject={vi.fn()}/>);
  const compact=screen.getByRole('region',{name:'Existing elements to replace'});
  expect(compact.textContent).toContain(`Replaces ${proposal.removals!.length} existing concept elements`);
  for(const removal of proposal.removals!)expect(compact.textContent).toContain(removal.elementId);
  expect(onAccept).not.toHaveBeenCalled();expect(source).toEqual(before);
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));const dialog=screen.getByRole('dialog'),removals=within(dialog).getByRole('region',{name:'Existing elements to replace'});
  const plan=within(dialog).getByRole('tabpanel'),warning=within(dialog).getByRole('note',{name:'Replacement review warning'});
  expect(warning.textContent).toContain(`Replaces ${proposal.removals!.length} existing concept elements`);expect(warning.compareDocumentPosition(plan)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(plan.compareDocumentPosition(removals)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const scroll=vi.fn();removals.scrollIntoView=scroll;fireEvent.click(within(warning).getByRole('button',{name:'Review exact replacement objects'}));expect(scroll).toHaveBeenCalledWith({block:'start'});expect(document.activeElement).toBe(removals);
  const firstRemoval=proposal.removals![0];fireEvent.click(within(removals).getByText('Exact before object · '+firstRemoval.elementId));
  expect(JSON.parse(removals.querySelector('pre')!.textContent!)).toEqual(firstRemoval.before);expect(within(dialog).getByText(/Only the listed existing objects are replaced/)).toBeTruthy();
  const scrollArea=within(dialog).getByRole('region',{name:'Created elements scroll area'});expect(scrollArea.getAttribute('tabindex')).toBe('0');expect(scrollArea.className).toContain('elements');
  expect(within(scrollArea).getAllByRole('row')).toHaveLength(proposal.creations!.length+1);expect(within(scrollArea).getByRole('columnheader',{name:'Floor'})).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button',{name:'Close dialog'}));expect(onAccept).not.toHaveBeenCalled();expect(source).toEqual(before);
 });

 it('accepts a replacement and new level as one transaction with complete affected IDs',async()=>{
  const blank=createBlankProject('Replan transaction'),source=applyProposal(blank,layoutProposal(blank,[],{idPrefix:'previous-concept'})),before=structuredClone(source),base=props(source),onApplied=vi.fn();
  let proposed:AiProposal|undefined;provider((project,ids)=>(proposed=layoutProposal(project,ids,{idPrefix:'new-two-floor-concept',replaceConcept:true,storeys:2,floorHeight:3.2})));
  render(<InspectorCopilot {...base} getCurrentProject={()=>structuredClone(source)} onApplied={onApplied}/>);sendPrompt('Improve the existing concept into two storeys, keeping the current room programme');await screen.findByText('House layout preview');
  expect(source).toEqual(before);expect(base.commit).not.toHaveBeenCalled();expect(proposed!.removals!.length).toBeGreaterThan(0);expect(proposed!.levelCreations).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Accept layout'}));expect(base.commit).toHaveBeenCalledTimes(1);expect(onApplied).toHaveBeenCalledTimes(1);expect(base.onSelect).not.toHaveBeenCalled();
  const [next,,ids]=base.commit.mock.calls[0] as unknown as [Project,string,string[]];
  expect(ids).toEqual([...new Set([...proposed!.creations!.map(creation=>creation.elementId),...proposed!.removals!.map(removal=>removal.elementId),...proposed!.levelCreations!.map(creation=>creation.levelId)])]);
  expect(next.version).toBe(source.version+1);for(const removal of proposed!.removals!)expect(next.elements.some(element=>element.id===removal.elementId)).toBe(false);
  expect(next.levels.some(level=>level.id===proposed!.levelCreations![0].levelId)).toBe(true);expect(source).toEqual(before);
 });

 it('offers an improvement prompt that preserves the actual programme and an explicit two-storey option',()=>{
  const blank=createBlankProject('Current programme'),source=applyProposal(blank,layoutProposal(blank,[],{idPrefix:'current-concept'})),base=props(source),view=render(<InspectorCopilot {...base}/>);
  const improve=screen.getByRole('button',{name:/Improve house layout/});expect((improve as HTMLButtonElement).disabled).toBe(false);fireEvent.click(improve);
  const input=screen.getByRole('textbox',{name:'Ask the BIM copilot'}) as HTMLTextAreaElement;expect(input.value).toMatch(/Keep the current requested room programme/);expect(input.value).toMatch(/retain the current storey count/);expect(input.value).not.toMatch(/three bedrooms|a kitchen, a dining/);
  fireEvent.click(screen.getByRole('button',{name:/Explore two storeys/}));expect(input.value).toMatch(/explore a two-storey arrangement with a connected stair/);expect(input.value).toMatch(/Do not substitute a new room programme/);
  const manual=createDemoProject();view.rerender(<InspectorCopilot {...base} project={manual} activeLevelId={manual.levels[0].id}/>);expect(screen.queryByRole('button',{name:/Improve house layout/})).toBeNull();expect((screen.getByRole('button',{name:/Create a house layout/}) as HTMLButtonElement).disabled).toBe(true);
 });

 it('replans the whole house when an upper slab piece is selected instead of using that tile as a footprint',()=>{
  const blank=createBlankProject('Upper-floor concept'),source=applyProposal(blank,layoutProposal(blank,[],{idPrefix:'two-floor-existing',storeys:2})),upper=source.elements.find(element=>element.kind==='slab'&&element.levelId!==source.levels[0].id)!;
  expect(upper.properties.layoutBaseLevelId).toBe(source.levels[0].id);
  const base=props(source);render(<InspectorCopilot {...base} selectedIds={[upper.id]} activeLevelId={upper.levelId}/>);
  fireEvent.click(screen.getByRole('button',{name:/Improve house layout/}));expect(base.onSelect).toHaveBeenCalledWith([]);
  const prompt=(screen.getByRole('textbox',{name:'Ask the BIM copilot'}) as HTMLTextAreaElement).value;
  expect(prompt).toMatch(/whole house from its original base level/);expect(prompt).toMatch(/instead of the selected upper slab piece/);expect(prompt).not.toMatch(/using the selected concept slab as its footprint/);expect(prompt).toMatch(/Keep the current requested room programme/);
 });

 it('shows measured compact-hub metrics in display units without implying walking-distance or daylight analysis',()=>{
  const source=createBlankProject('Measured hub');source.units='ft';const programme:LayoutProposal['rooms']=[
   {key:'bed1',name:'Bedroom one',use:'bedroom',area:14,attachedTo:null},{key:'bath1',name:'Ensuite one',use:'bathroom',area:4.5,attachedTo:'bed1'},
   {key:'bed2',name:'Bedroom two',use:'bedroom',area:14,attachedTo:null},{key:'bath2',name:'Ensuite two',use:'bathroom',area:4.5,attachedTo:'bed2'},
   {key:'bed3',name:'Bedroom three',use:'bedroom',area:14,attachedTo:null},{key:'bath3',name:'Ensuite three',use:'bathroom',area:4.5,attachedTo:'bed3'},
   {key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null},{key:'library',name:'Library',use:'study',area:9,attachedTo:null},{key:'pool',name:'Pool zone',use:'pool',area:24,attachedTo:null},
  ],proposal=layoutProposal(source,[],{rooms:programme,idPrefix:'measured-hub'}),measured=previewLayout(source,proposal.layout!),before=structuredClone(source),preview=applyProposal(source,proposal);
  expect(measured.strategy).toBe('compact-hub');expect(measured.metrics!.hubArea).toBeGreaterThan(0);
  render(<LayoutProposalPreview source={source} preview={preview} proposal={proposal} disabled={false} onAccept={vi.fn()} onReject={vi.fn()}/>);
  const compact=screen.getByRole('region',{name:'Whole-house planning metrics'});expect(within(compact).getByText('Compact hub')).toBeTruthy();expect(compact.textContent).toContain('Whole house · all floors');
  expect(compact.textContent).toContain(`${num(measured.metrics!.hubArea*10.7639104167,1)} ft²`);expect(compact.textContent).toContain(`${(measured.metrics!.longestAccessBranch*3.280839895).toFixed(2)} ft`);
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));const dialog=screen.getByRole('dialog'),full=within(dialog).getByRole('region',{name:'Whole-house planning metrics'}),plan=within(dialog).getByRole('tabpanel');
  expect(plan.compareDocumentPosition(full)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(full.textContent).toContain(`${num(measured.metrics!.circulationRatio*100,1)}%`);expect(full.textContent).toContain('not walking distance');expect(within(full).getByText('Dedicated circulation area / share')).toBeTruthy();expect(full.textContent).toContain('excludes paths within requested living/dining rooms');expect(full.textContent).toContain('not daylight analysis');expect(source).toEqual(before);
 });

 it('labels the genuinely constrained gallery fixture without presenting it as a compact hub',()=>{
  const source=createBlankProject('Constrained gallery'),type=source.types.find(type=>type.kind==='slab')!;source.elements.push({id:'fixed-slab',kind:'slab',name:'Retained surveyed footprint',levelId:source.levels[0].id,typeId:type.id,material:type.material,x:24,y:-7,z:-.2,width:10.4,depth:14,height:.2,rotation:27,editable:true,properties:{}});
  const rooms:LayoutProposal['rooms']=[
   {key:'bed1',name:'Bedroom one',use:'bedroom',area:14,attachedTo:null},{key:'bath1',name:'Ensuite one',use:'bathroom',area:4.5,attachedTo:'bed1'},
   {key:'bed2',name:'Bedroom two',use:'bedroom',area:14,attachedTo:null},{key:'bath2',name:'Ensuite two',use:'bathroom',area:4.5,attachedTo:'bed2'},
   {key:'bed3',name:'Bedroom three',use:'bedroom',area:14,attachedTo:null},{key:'bath3',name:'Ensuite three',use:'bathroom',area:4.5,attachedTo:'bed3'},
   {key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null},{key:'library',name:'Library',use:'study',area:9,attachedTo:null},{key:'pool',name:'Pool zone',use:'pool',area:24,attachedTo:null},
  ],proposal=layoutProposal(source,['fixed-slab'],{rooms,idPrefix:'gallery-review'}),measured=previewLayout(source,proposal.layout!),before=structuredClone(source);
  expect(measured.strategy).toBe('zoned-gallery');expect(measured.metrics!.hubArea).toBe(0);
  render(<LayoutProposalPreview source={source} preview={applyProposal(source,proposal)} proposal={proposal} disabled={false} onAccept={vi.fn()} onReject={vi.fn()}/>);
  const summary=screen.getByRole('region',{name:'Whole-house planning metrics'});expect(within(summary).getByText('Zoned gallery')).toBeTruthy();expect(within(summary).queryByText('Compact hub')).toBeNull();expect(summary.textContent).toContain('Uses gallery circulation');expect(summary.textContent).toContain('0 m²');expect(source).toEqual(before);
 });

 it('shows the current connection model without rewriting a historical proposal model',async()=>{
  const project=createBlankProject('Historical provenance');provider((project,ids)=>({...layoutProposal(project,ids),model:'gpt-4.1-mini'}));render(<InspectorCopilot {...props(project)} model="custom-model-identifier"/>);sendPrompt();
  await screen.findByText('House layout preview');expect(screen.getByText(/custom-model-identifier/)).toBeTruthy();expect(screen.getByText(/gpt-4.1-mini · Quantities/)).toBeTruthy();
 });

 it('compares only distinct options and exposes their real room guides without applying anything',async()=>{
  const source=createBlankProject('One-room alternatives'),before=structuredClone(source),base=props(source);
  provider((project,ids)=>layoutProposal(project,ids,{rooms:[{key:'living',name:'Living room',use:'living',area:20,attachedTo:null}]}));
  render(<InspectorCopilot {...base}/>);sendPrompt('Create one living space');await screen.findByText('House layout preview');
  const comparison=screen.getByRole('region',{name:'Design alternatives'});
  expect(within(comparison).getByText('1 distinct arrangement')).toBeTruthy();expect(within(comparison).getAllByRole('button')).toHaveLength(1);
  expect(within(comparison).getByRole('button',{name:'Review Balanced layout'}).getAttribute('aria-pressed')).toBe('true');
  expect(comparison.textContent).toContain('same physical arrangement');expect(comparison.textContent).toContain('mapped-cost coverage');expect(comparison.textContent).toContain('calendar days');expect(comparison.textContent).toContain('accepting a layout does not approve its construction plan');
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));const dialog=screen.getByRole('dialog'),quality=within(dialog).getByRole('region',{name:'Room planning quality'});
  expect(within(quality).getByRole('table',{name:'Room proportion and fit guides'})).toBeTruthy();expect(quality.textContent).toContain('Actual / upper area guide');expect(quality.textContent).toContain('Assumed fit rectangle');expect(quality.textContent).toContain('Furniture, door swings');
  fireEvent.click(within(dialog).getByRole('button',{name:'Reject layout'}));expect(base.commit).not.toHaveBeenCalled();expect(source).toEqual(before);
 });

 it('shows unresolved activity durations as unavailable while keeping unknown costs visible',async()=>{
  const source=createBlankProject('Unresolved productivity'),base=props(source),wallType=source.types.find(type=>type.kind==='wall')!;wallType.materialRate=null;source.schedule.activities=[{id:'unresolved-task',name:'Unresolved task',category:'allowance',quantity:1,unit:'scope item',productivity:1,minDuration:1,predecessors:['missing-prerequisite'],crewDemand:1,maxCrews:1,leadTime:0,quantityMode:'manual',sourceElementIds:['removed-task-source']}];source.schedule.activities.push({...source.schedule.activities[0],id:'second-task',name:'Second task',predecessors:[],sourceElementIds:['other-removed-source']});
  provider();render(<InspectorCopilot {...base}/>);sendPrompt();await screen.findByText('House layout preview');
  const comparison=screen.getByRole('region',{name:'Design alternatives'});
  expect(comparison.textContent).toContain('Unavailable until plan review');expect(comparison.textContent).toContain('mapped-cost coverage');expect(comparison.textContent).not.toContain('0 calendar days');
  expect(screen.getByText('Review activities')).toBeTruthy();expect(screen.getByText(/Completion-time change is unavailable/)).toBeTruthy();
  const alert=screen.getByRole('alert');expect(within(alert).getByText('Construction plan needs review')).toBeTruthy();expect(within(alert).getByRole('list')).toBeTruthy();expect(within(alert).getAllByRole('listitem')).toHaveLength(2);expect(alert.textContent).toContain('removed-task-source');expect(alert.textContent).toContain('other-removed-source');expect(alert.className).toBe('notice warning');expect((screen.getByRole('button',{name:'Accept layout'})as HTMLButtonElement).disabled).toBe(false);
  expect(base.commit).not.toHaveBeenCalled();
 });

 // This full alternative-generation/modal/acceptance path needs headroom on shared CI CPUs.
 it('switches to a distinct design and accepts precisely its reviewed elements in one transaction',async()=>{
  const source=createBlankProject('Selectable design options'),before=structuredClone(source),base=props(source),onApplied=vi.fn();let offered:AiProposal|undefined;
  const api=provider((project,ids)=>(offered=layoutProposal(project,ids,{rooms:nineRoomProgramme(),storeys:1})));
  render(<InspectorCopilot {...base} onApplied={onApplied} getCurrentProject={()=>structuredClone(source)}/>);sendPrompt('Design this nine-room house');await screen.findByText('House layout preview',{}, {timeout:5000});
  const choices=generateLayoutAlternatives(source,offered!),chosen=choices.alternatives.find(option=>option.variant==='daylight')!;expect(chosen).toBeTruthy();
  const comparison=screen.getByRole('region',{name:'Design alternatives'});fireEvent.click(within(comparison).getByRole('button',{name:'Review Window priority layout'}));
  expect(within(comparison).getByRole('button',{name:'Review Window priority layout'}).getAttribute('aria-pressed')).toBe('true');expect(within(comparison).getByRole('button',{name:'Review Balanced layout'}).getAttribute('aria-pressed')).toBe('false');
  expect(base.commit).not.toHaveBeenCalled();expect(source).toEqual(before);expect(api.requests).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));const dialog=screen.getByRole('dialog'),elements=within(dialog).getByRole('table',{name:'Complete proposed creation list'});
  for(const creation of chosen.proposal.creations!)expect(elements.textContent).toContain(creation.elementId);
  expect(elements.textContent).not.toContain(offered!.creations![0].elementId);expect(within(dialog).getByRole('button',{name:'Review Window priority layout'}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(dialog).getByRole('button',{name:'Accept layout'}));expect(base.commit).toHaveBeenCalledTimes(1);expect(onApplied).toHaveBeenCalledWith(chosen.proposal);
  const [next,,ids]=base.commit.mock.calls[0] as unknown as [Project,string,string[]];expect(next.elements).toEqual(chosen.preview.elements);expect(next.version).toBe(source.version+1);expect(ids).toEqual(chosen.proposal.creations!.map(creation=>creation.elementId));expect(source).toEqual(before);
 },15000);

 it('keeps an alternative visible after a source revision but cannot accept it, then rejects without edits',async()=>{
  const source=createBlankProject('Stale selected design'),before=structuredClone(source),base=props(source),api=provider((project,ids)=>layoutProposal(project,ids,{rooms:nineRoomProgramme(),storeys:1})),view=render(<InspectorCopilot {...base}/>);
  sendPrompt();await screen.findByText('House layout preview',{}, {timeout:5000});view.rerender(<InspectorCopilot {...base} project={{...source,version:source.version+1}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Review Window priority layout'}));expect((screen.getByRole('button',{name:'Accept layout'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('img',{name:/Proposed house floor plan/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));const dialog=screen.getByRole('dialog');expect((within(dialog).getByRole('button',{name:'Accept layout'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('button',{name:'Reject layout'}));expect(base.commit).not.toHaveBeenCalled();expect(source).toEqual(before);expect(api.requests).toHaveLength(1);expect(screen.getByText('Proposal rejected. Your project is unchanged.')).toBeTruthy();
 });
});
