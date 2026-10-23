// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import InspectorCopilot from '../src/components/InspectorCopilot';
import LayoutProposalPreview from '../src/components/LayoutProposalPreview';
import {createBlankProject} from '../src/domain/seed';
import {previewLayout} from '../src/domain/layout';
import {applyProposal} from '../src/domain/transactions';
import {DEFAULT_AI_MODEL} from '../src/domain/aiConfig';
import {num} from '../src/components/ui';
import type {AiProposal,LayoutProposal,Project} from '../src/domain/types';

function layoutProposal(project:Project,selectedIds:string[]=[]):AiProposal {
 const spec:LayoutProposal={levelId:project.levels[0].id,footprintId:selectedIds[0]??null,width:null,depth:null,idPrefix:'layout-ui-review',baselineVersion:project.version,rooms:[
  {key:'living',name:'Living room',use:'living',area:20,attachedTo:null},
  {key:'bedroom',name:'Primary bedroom',use:'bedroom',area:14,attachedTo:null},
  {key:'ensuite',name:'Attached bathroom',use:'bathroom',area:4.5,attachedTo:'bedroom'},
  {key:'bath',name:'Common bathroom',use:'bathroom',area:null,attachedTo:null},
 ]};
 const output=previewLayout(project,spec);if(output.issues.length)throw new Error(output.issues.join(' '));
 return{id:spec.idPrefix,prompt:'Create a house layout',summary:'Proposed house with four requested rooms and connected circulation',kind:'layout',changes:[],issues:output.assumptions,selectedIds,model:DEFAULT_AI_MODEL,createdAt:'2026-10-24T12:00:00Z',layout:spec,creations:output.elements.map(after=>({elementId:after.id,before:null,after}))};
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
  render(<InspectorCopilot {...base} onApplied={onApplied} getCurrentProject={()=>structuredClone(project)}/>);sendPrompt();
  await screen.findByText('House layout preview');expect(project).toEqual(before);expect(base.commit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));const dialog=screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button',{name:'Accept layout'}));
  expect(base.commit).toHaveBeenCalledTimes(1);expect(onApplied).toHaveBeenCalledTimes(1);expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByRole('button',{name:'Accept layout'})).toBeNull();
  const [next,action,ids]=base.commit.mock.calls[0] as unknown as [Project,string,string[]],expected=layoutProposal(api.requests[0].project);
  expect(next.elements).toEqual(expected.creations!.map(creation=>creation.after));expect(next.version).toBe(project.version+1);expect(ids).toEqual(expected.creations!.map(creation=>creation.elementId));expect(action).toMatch(/Accepted AI proposal/);
  for(const opening of next.elements.filter(element=>element.hostId))expect(next.elements.find(element=>element.id===opening.hostId)?.kind).toBe('wall');
  expect(project).toEqual(before);expect(screen.getByText(/Changes applied. You can undo/)).toBeTruthy();
 });

 it('keeps a changed-model preview visible but disables accepting its stale revision',async()=>{
  const project=createBlankProject('Stale review'),api=provider(),base=props(project),view=render(<InspectorCopilot {...base}/>);sendPrompt();await screen.findByText('House layout preview');
  view.rerender(<InspectorCopilot {...base} project={{...project,version:project.version+1}}/>);
  expect((screen.getByRole('button',{name:'Accept layout'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('img',{name:/Proposed house floor plan/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Review plan & all/}));expect((within(screen.getByRole('dialog')).getByRole('button',{name:'Accept layout'}) as HTMLButtonElement).disabled).toBe(true);
  expect(base.commit).not.toHaveBeenCalled();expect(api.requests).toHaveLength(1);
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

 it('shows the current connection model without rewriting a historical proposal model',async()=>{
  const project=createBlankProject('Historical provenance');provider((project,ids)=>({...layoutProposal(project,ids),model:'gpt-4.1-mini'}));render(<InspectorCopilot {...props(project)} model="custom-model-identifier"/>);sendPrompt();
  await screen.findByText('House layout preview');expect(screen.getByText(/custom-model-identifier/)).toBeTruthy();expect(screen.getByText(/gpt-4.1-mini · Quantities/)).toBeTruthy();
 });
});
