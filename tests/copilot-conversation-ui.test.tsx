// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import InspectorCopilot from '../src/components/InspectorCopilot';
import {StrictMode} from 'react';
import {createBlankProject,createDemoProject} from '../src/domain/seed';
import type {AiProposal,Project} from '../src/domain/types';
import type {CopilotTurn} from '../src/domain/copilotConversation';

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const info=(id:string,prompt:string,summary:string):AiProposal=>({id,prompt,summary,kind:'analysis',changes:[],issues:[],selectedIds:[],createdAt:'2026-10-24T12:00:00Z',model:'test'});
function edit(project:Project,id='original-turn'):AiProposal{
 const element=project.elements.find(item=>item.kind==='window')!,target=project.types.find(type=>type.id==='window-thermal')!;
 return{...info(id,'Upgrade these windows','Thermal-break window proposal'),kind:'edit',selectedIds:[element.id],changes:[{elementId:element.id,before:{typeId:element.typeId,material:element.material},after:{typeId:target.id,material:target.material}}]};
}
function turn(proposal:AiProposal,project:Project,status:CopilotTurn['status']='analysis'):CopilotTurn{return{id:proposal.id,prompt:proposal.prompt,summary:proposal.summary,issues:proposal.issues,kind:proposal.kind,selectedIds:proposal.selectedIds,status,projectVersion:project.version,createdAt:proposal.createdAt,...(proposal.layout?{layout:proposal.layout}:{})};}
function props(project:Project){return{project,selectedIds:project.elements.filter(item=>item.kind==='window').slice(0,1).map(item=>item.id),activeLevelId:project.levels[0].id,onSelect:vi.fn(),onUpdate:vi.fn(),onDelete:vi.fn(),commit:vi.fn(),notify:vi.fn(),role:'admin' as const,aiReady:true};}
function send(prompt:string){fireEvent.change(screen.getByRole('textbox',{name:'Ask the BIM copilot'}),{target:{value:prompt}});fireEvent.click(screen.getByRole('button',{name:'Send copilot request'}));}
function history(){const section=screen.getByRole('region',{name:'Project copilot conversation'});const summary=within(section).getByText(/^Conversation/).closest('summary')!;if(!summary.closest('details')!.open)fireEvent.click(summary);return section;}
function api(project:Project,initial:CopilotTurn[]=[],propose=(body:{prompt:string;project:Project;selectedIds:string[]})=>info(`turn-${body.prompt}`,body.prompt,'Response to '+body.prompt)){
 let saved=structuredClone(initial);const requests:any[]=[];
 const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/usage')return json({ok:true});
  if(url==='/api/copilot'){
   const body=JSON.parse(String(init?.body));requests.push(body);const value=await propose(body);const mutating=Boolean(value.changes.length||value.layout||value.crewCount!==undefined||value.creations?.length||value.repetition);
   saved=[...saved.map(item=>mutating&&item.status==='proposed'?{...item,status:'superseded' as const}:item),turn(value,project,mutating?'proposed':'analysis')];return json({...value,conversationTurnId:value.id});
  }
  if(url.includes('/copilot/conversation')){
   if(init?.method==='DELETE')saved=[];
   if(init?.method==='PATCH'){const status=JSON.parse(String(init.body)).status,id=decodeURIComponent(url.split('?')[0].split('/').at(-1)!);saved=saved.map(item=>item.id===id?{...item,status}:item);}
   return json({conversation:{projectId:url.split('/')[3],turns:saved}});
  }
  throw new Error('Unexpected endpoint '+url);
 });vi.stubGlobal('fetch',fetch);return{fetch,requests,saved:()=>saved};
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('project copilot conversation and pending intent',()=>{
 it('restores history when React repeats mount effects in Strict Mode',async()=>{
  const project=createDemoProject(),base=props(project);api(project,[turn(info('strict-history','Keep the library','The library is retained.'),project)]);render(<StrictMode><InspectorCopilot {...base}/></StrictMode>);await waitFor(()=>expect(within(history()).getByText('Keep the library')).toBeTruthy());
 });

 it('keeps a clarification and pronoun follow-up in the thread, then records the applied outcome',async()=>{
  const project=createDemoProject(),base=props(project);let count=0;
  const server=api(project,[],body=>++count===1?info('clarification',body.prompt,'Would you like the thermal-break alternative for those windows?'):{...edit(body.project),prompt:body.prompt});
  render(<InspectorCopilot {...base}/>);send('Can you improve these windows?');
  await waitFor(()=>expect(within(history()).getByText('Can you improve these windows?')).toBeTruthy());
  send('Yes, use that for them.');await screen.findByRole('button',{name:'Accept changes'});
  expect(server.requests.map(item=>item.prompt)).toEqual(['Can you improve these windows?','Yes, use that for them.']);
  expect(server.requests[1].selectedIds).toEqual(base.selectedIds);expect(server.requests[1]).not.toHaveProperty('history');
  const log=within(history()).getByRole('list',{name:'Conversation history'});expect(within(log).getAllByRole('listitem')).toHaveLength(2);expect(log.textContent).toContain('Would you like the thermal-break alternative');
  expect(base.commit).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Accept changes'}));
  await waitFor(()=>expect(within(history()).getByText('Applied')).toBeTruthy());
  expect(base.commit).toHaveBeenCalledOnce();expect(server.fetch.mock.calls.some(([url,init])=>url.split('?')[0].endsWith('/turns/original-turn')&&init?.method==='PATCH')).toBe(true);
 });

 it('keeps the existing review and composer when a follow-up fails, including while it is pending',async()=>{
  const project=createDemoProject(),base=props(project);let count=0,fail!:()=>void;const gate=new Promise<AiProposal>((_,reject)=>fail=()=>reject(new Error('Provider temporarily unavailable')));
  const server=api(project,[],body=>++count===1?{...edit(body.project),prompt:body.prompt}:gate as any);
  render(<InspectorCopilot {...base}/>);send('Upgrade these windows');await screen.findByRole('button',{name:'Accept changes'});
  send('Make that cheaper instead');expect(screen.getByRole('button',{name:'Accept changes'}).hasAttribute('disabled')).toBe(true);expect(screen.getByRole('heading',{name:'Thermal-break window proposal'})).toBeTruthy();
  await act(async()=>fail());await screen.findByText('Provider temporarily unavailable');
  expect((screen.getByRole('textbox',{name:'Ask the BIM copilot'})as HTMLTextAreaElement).value).toBe('Make that cheaper instead');expect(screen.getByRole('button',{name:'Accept changes'}).hasAttribute('disabled')).toBe(false);
  expect(base.commit).not.toHaveBeenCalled();expect(server.saved()).toHaveLength(1);expect(server.saved()[0].status).toBe('proposed');
 });

 it('retains conversation across revision changes and restores it on navigation remount',async()=>{
  const project=createDemoProject(),saved=turn(info('saved','Keep the library','The library remains in the programme.'),project),server=api(project,[saved]),base=props(project),view=render(<InspectorCopilot {...base}/>);
  await waitFor(()=>expect(within(history()).getByText('Keep the library')).toBeTruthy());
  view.rerender(<InspectorCopilot {...base} project={{...project,version:project.version+1}}/>);
  expect(within(history()).getByText('Keep the library')).toBeTruthy();expect(server.fetch.mock.calls.filter(([url,init])=>url.endsWith('/conversation')&&!init?.method)).toHaveLength(1);
  view.unmount();render(<InspectorCopilot {...base}/>);await waitFor(()=>expect(within(history()).getByText('Keep the library')).toBeTruthy());
  expect(server.fetch.mock.calls.filter(([url,init])=>url.endsWith('/conversation')&&!init?.method)).toHaveLength(2);
 });

 it('clears the composer on project/branch changes and ignores a late response from the previous project',async()=>{
  const project=createDemoProject(),next=createBlankProject('Another project'),base=props(project);let resolve!: (proposal:AiProposal)=>void;const gate=new Promise<AiProposal>(done=>resolve=done);api(project,[],()=>gate as any);
  const view=render(<InspectorCopilot {...base}/>);send('Upgrade these windows');await waitFor(()=>expect(screen.getByText('Working with your project…')).toBeTruthy());
  view.rerender(<InspectorCopilot {...props(next)}/>);expect((screen.getByRole('textbox',{name:'Ask the BIM copilot'})as HTMLTextAreaElement).value).toBe('');
  await act(async()=>resolve(edit(project)));expect(screen.queryByRole('button',{name:'Accept changes'})).toBeNull();expect(base.commit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox',{name:'Ask the BIM copilot'}),{target:{value:'Draft on this branch'}});
  const branched={...next,workbench:{schemaVersion:1,activeProposalId:'branch-b',proposals:[{id:'branch-b',name:'Branch B',modelJson:'{}'}],layers:[]}}as Project;
  view.rerender(<InspectorCopilot {...props(branched)}/>);expect((screen.getByRole('textbox',{name:'Ask the BIM copilot'})as HTMLTextAreaElement).value).toBe('');
 });

 it('starts a new conversation only after the explicit reset succeeds, without changing the model',async()=>{
  const project=createDemoProject(),saved=turn(info('saved','Keep the library','The library remains.'),project),server=api(project,[saved]),base=props(project);render(<InspectorCopilot {...base}/>);
  await waitFor(()=>expect(within(history()).getByText('Keep the library')).toBeTruthy());fireEvent.change(screen.getByRole('textbox',{name:'Ask the BIM copilot'}),{target:{value:'Unsent follow-up'}});
  fireEvent.click(screen.getByRole('button',{name:'New conversation'}));await screen.findByText('New conversation started. The model is unchanged.');
  expect(server.saved()).toEqual([]);expect(within(history()).queryByText('Keep the library')).toBeNull();expect((screen.getByRole('textbox',{name:'Ask the BIM copilot'})as HTMLTextAreaElement).value).toBe('');expect(base.commit).not.toHaveBeenCalled();
 });

 it('does not mark a proposal applied when the workspace refuses the commit',async()=>{
  const project=createDemoProject(),base={...props(project),commit:vi.fn(()=>false)},server=api(project,[],body=>edit(body.project));render(<InspectorCopilot {...base}/>);send('Upgrade these windows');await screen.findByRole('button',{name:'Accept changes'});
  fireEvent.click(screen.getByRole('button',{name:'Accept changes'}));await screen.findByText(/The model change was not accepted/);
  expect(screen.getByRole('button',{name:'Accept changes'})).toBeTruthy();expect(server.fetch.mock.calls.some(([,init])=>init?.method==='PATCH')).toBe(false);expect(within(history()).getByText('Awaiting review')).toBeTruthy();
 });

 it('restores the pending layout brief without pretending that its geometry was accepted or reviewable',async()=>{
  const project=createBlankProject('Pending house'),proposal={...info('pending-layout','Keep two bedrooms and a library','House layout awaits review'),kind:'layout',layout:{levelId:project.levels[0].id,footprintId:null,width:null,depth:null,idPrefix:'pending-layout',baselineVersion:project.version,storeys:2,rooms:[{key:'library',name:'Family library',use:'study',area:12,attachedTo:null}]}}as AiProposal;
  api(project,[turn(proposal,project,'proposed')]);const base=props(project);render(<InspectorCopilot {...base}/>);
  await screen.findByText('Pending layout brief · 1 space');fireEvent.click(screen.getByText('Pending layout brief · 1 space'));expect(screen.getByText(/2 storeys · Family library/)).toBeTruthy();expect(screen.getByText(/it has not been applied/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Accept layout'})).toBeNull();expect(base.commit).not.toHaveBeenCalled();
 });

 it('keeps history, a pending review and unsent text when an explicit reset fails',async()=>{
  const project=createDemoProject(),base=props(project),server=api(project,[],body=>edit(body.project));const original=globalThis.fetch;
  vi.stubGlobal('fetch',vi.fn((url:string,init?:RequestInit)=>init?.method==='DELETE'?Promise.resolve(json({error:'Conversation is busy; retry shortly.'},409)):original(url,init)));
  render(<InspectorCopilot {...base}/>);send('Upgrade these windows');await screen.findByRole('button',{name:'Accept changes'});
  fireEvent.change(screen.getByRole('textbox',{name:'Ask the BIM copilot'}),{target:{value:'Keep the dimensions too'}});fireEvent.click(screen.getByRole('button',{name:'New conversation'}));
  await screen.findByText('Conversation is busy; retry shortly.');expect(screen.getByRole('button',{name:'Accept changes'})).toBeTruthy();expect((screen.getByRole('textbox',{name:'Ask the BIM copilot'})as HTMLTextAreaElement).value).toBe('Keep the dimensions too');expect(server.saved()).toHaveLength(1);expect(base.commit).not.toHaveBeenCalled();
 });

 it('flushes an active design branch before loading its server-selected conversation',async()=>{
  const blank=createBlankProject('Branch context'),project={...blank,workbench:{schemaVersion:1,activeProposalId:'branch-b',proposals:[{id:'branch-b',name:'Branch B',modelJson:'{}'}],layers:[]}}as Project,base=props(project),server=api(project,[turn(info('branch-turn','Keep this branch library','Branch B library retained.'),project)]);
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),flush=vi.fn(()=>gate);render(<InspectorCopilot {...base} beforeRequest={flush}/>);
  expect(flush).toHaveBeenCalledOnce();expect(server.fetch).not.toHaveBeenCalled();
  await act(async()=>release());await waitFor(()=>expect(within(history()).getByText('Keep this branch library')).toBeTruthy());expect(server.fetch.mock.calls.filter(([url])=>url.endsWith('/conversation'))).toHaveLength(1);
 });

 it('does not let a slow history load replace a newly returned response',async()=>{
  const project=createDemoProject(),base=props(project);api(project,[],body=>edit(body.project));const original=globalThis.fetch;let loaded!:(response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn((url:string,init?:RequestInit)=>url.endsWith('/conversation')&&!init?.method?new Promise<Response>(resolve=>loaded=resolve):original(url,init)));
  render(<InspectorCopilot {...base}/>);send('Upgrade these windows');await screen.findByRole('button',{name:'Accept changes'});
  await act(async()=>loaded(json({conversation:{projectId:project.id,turns:[]}})));
  expect(within(history()).getByText('Upgrade these windows')).toBeTruthy();expect(within(history()).getByText('Awaiting review')).toBeTruthy();
 });

 it('preserves text composed while a response is pending and handles malformed history without hiding a send failure',async()=>{
  const project=createDemoProject(),base=props(project);let release!:(proposal:AiProposal)=>void,sends=0;const gate=new Promise<AiProposal>(resolve=>release=resolve);api(project,[],()=>gate as any);const original=globalThis.fetch;
  vi.stubGlobal('fetch',vi.fn((url:string,init?:RequestInit)=>url.endsWith('/conversation')&&!init?.method?Promise.resolve(json({conversation:{projectId:project.id,turns:[null]}})):url==='/api/copilot'&&++sends>1?Promise.resolve(json({error:'The actual provider request failed.'},503)):original(url,init)));
  render(<InspectorCopilot {...base}/>);await screen.findByText(/Saved conversation history is unavailable/);send('Upgrade these windows');
  fireEvent.change(screen.getByRole('textbox',{name:'Ask the BIM copilot'}),{target:{value:'And keep their dimensions'}});await act(async()=>release(edit(project)));await screen.findByRole('button',{name:'Accept changes'});
  expect((screen.getByRole('textbox',{name:'Ask the BIM copilot'})as HTMLTextAreaElement).value).toBe('And keep their dimensions');expect(base.commit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Send copilot request'}));await screen.findByText('The actual provider request failed.');expect(screen.getByRole('alert').textContent).toContain('The actual provider request failed.');expect((screen.getByRole('textbox',{name:'Ask the BIM copilot'})as HTMLTextAreaElement).value).toBe('And keep their dimensions');
 });

 it('records rejection before a follow-up POST can reuse the pending intent, even after navigation remount',async()=>{
  const project=createDemoProject(),base=props(project),server=api(project,[],body=>edit(body.project));const original=globalThis.fetch;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(init?.method==='PATCH')await gate;return original(url,init);}));
  const view=render(<InspectorCopilot {...base}/>);send('Upgrade these windows');await screen.findByRole('button',{name:'Accept changes'});fireEvent.click(screen.getByRole('button',{name:'Reject'}));
  view.unmount();render(<InspectorCopilot {...base}/>);send('Use only ten percent instead');await act(async()=>{});expect(server.requests).toHaveLength(1);
  await act(async()=>release());await waitFor(()=>expect(server.requests).toHaveLength(2));
  const calls=server.fetch.mock.calls.filter(([,init])=>init?.method==='PATCH'||init?.method==='POST');expect(calls.findIndex(([,init])=>init?.method==='PATCH')).toBeLessThan(calls.map(([url])=>url).lastIndexOf('/api/copilot'));
 });

 it('waits for the outgoing outcome before resetting the conversation',async()=>{
  const project=createDemoProject(),base=props(project),server=api(project,[],body=>edit(body.project));const original=globalThis.fetch;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(init?.method==='PATCH')await gate;return original(url,init);}));
  render(<InspectorCopilot {...base}/>);send('Upgrade these windows');await screen.findByRole('button',{name:'Accept changes'});fireEvent.click(screen.getByRole('button',{name:'Reject'}));fireEvent.click(screen.getByRole('button',{name:'New conversation'}));await act(async()=>{});
  expect(server.fetch.mock.calls.some(([,init])=>init?.method==='DELETE')).toBe(false);await act(async()=>release());await screen.findByText('New conversation started. The model is unchanged.');expect(server.saved()).toEqual([]);
 });

 it('keeps an accepted local change when saving fails, blocks follow-up intent, and retries save before marking applied',async()=>{
  const project=createDemoProject(),base=props(project),server=api(project,[],body=>edit(body.project));let saves=0;const save=vi.fn(async()=>{if(++saves===2)throw new Error('Disk temporarily unavailable');});
  render(<InspectorCopilot {...base} beforeRequest={save}/>);send('Upgrade these windows');await screen.findByRole('button',{name:'Accept changes'});fireEvent.click(screen.getByRole('button',{name:'Accept changes'}));
  await screen.findByText(/The change is applied locally, but the project save failed/);expect(base.commit).toHaveBeenCalledOnce();expect(server.fetch.mock.calls.some(([,init])=>init?.method==='PATCH')).toBe(false);
  send('Use only ten percent instead');await screen.findByText(/Retry the conversation status before continuing/);expect(server.requests).toHaveLength(1);expect((screen.getByRole('textbox',{name:'Ask the BIM copilot'})as HTMLTextAreaElement).value).toBe('Use only ten percent instead');
  fireEvent.click(screen.getByRole('button',{name:'Retry conversation status'}));await waitFor(()=>expect(server.saved()[0].status).toBe('applied'));expect(base.commit).toHaveBeenCalledOnce();expect(save).toHaveBeenCalledTimes(3);
 });
});
