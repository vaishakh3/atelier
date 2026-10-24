import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {RecordStore} from '../server/storage';
import {CopilotConversationStore} from '../server/copilotConversation';
import {createBlankProject} from '../src/domain/seed';
import type {AiProposal,Project} from '../src/domain/types';

const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
const proposal=(id:string,mutating=false):AiProposal=>({id,prompt:'Retain the family library',summary:'A bounded design response',kind:mutating?'layout':'analysis',changes:[],selectedIds:[],issues:[],model:'fixture',createdAt:new Date().toISOString(),...(mutating?{layout:{levelId:'level-0',footprintId:null,width:null,depth:null,idPrefix:id,baselineVersion:1,rooms:[{key:'library',name:'Family library',use:'study',area:12,attachedTo:null}]}}:{})});
async function fixture(){const directory=await mkdtemp(path.join(tmpdir(),'atelier-conversation-'));directories.push(directory);const store=new RecordStore(directory,Buffer.alloc(32,62));return{directory,store,history:new CopilotConversationStore(store),project:createBlankProject('Conversation test')};}
async function append(history:CopilotConversationStore,key:string,project:Project,value:AiProposal){const start=await history.begin(key,project.id);return history.complete(key,project,start.epoch,value);}

describe('bounded encrypted copilot conversation memory',()=>{
 it('keeps unencrypted development history volatile and isolated without writing prompt files',async()=>{
  const project=createBlankProject('Volatile context'),history=new CopilotConversationStore(),key=history.key('hashed-session-a',project);
  await append(history,key,project,proposal('volatile-turn'));expect(history.persistent).toBe(false);expect((await history.get(key,project.id)).turns).toHaveLength(1);
  expect((await history.get(history.key('hashed-session-b',project),project.id)).turns).toEqual([]);
  expect((await new CopilotConversationStore().get(key,project.id)).turns).toEqual([]);
 });
 it('evicts old volatile threads at the bounded development-session limit',async()=>{
  const project=createBlankProject('Bounded volatile sessions'),history=new CopilotConversationStore();
  for(let i=0;i<257;i++){const key=history.key(`session-${i}`,project);await append(history,key,project,proposal(`turn-${i}`));}
  expect((await history.get(history.key('session-0',project),project.id)).turns).toEqual([]);
  expect((await history.get(history.key('session-256',project),project.id)).turns[0].id).toBe('turn-256');
 });
 it('retains complete pending layout intent across clarification, restarts and bounded history without plaintext prompts',async()=>{
  const f=await fixture(),key=f.history.key('user-owner',f.project);await append(f.history,key,f.project,proposal('layout-one',true));
  await append(f.history,key,f.project,proposal('clarification'));
  const restarted=new CopilotConversationStore(new RecordStore(f.directory,Buffer.alloc(32,62))),loaded=await restarted.begin(key,f.project.id);
  expect(loaded.turns.map(turn=>turn.status)).toEqual(['proposed','analysis']);expect(loaded.pendingProposal?.layout?.rooms[0].name).toBe('Family library');
  for(let i=0;i<14;i++)await append(restarted,key,f.project,proposal(`analysis-${i}`));
  const bounded=await restarted.begin(key,f.project.id);expect(bounded.turns).toHaveLength(12);expect(bounded.turns[0].id).toBe('analysis-2');expect(bounded.pendingProposal?.id).toBe('layout-one');
  for(const filename of(await readdir(f.directory)).filter(name=>name.endsWith('.atelier')))expect(await readFile(path.join(f.directory,filename),'utf8')).not.toContain('Retain the family library');
 });
 it('supersedes only an earlier mutating proposal and clears pending on an explicit outcome',async()=>{
  const f=await fixture(),key=f.history.key('user-owner',f.project);await append(f.history,key,f.project,proposal('layout-one',true));await append(f.history,key,f.project,proposal('explanation'));await append(f.history,key,f.project,proposal('layout-two',true));
  expect((await f.history.get(key,f.project.id)).turns.map(turn=>turn.status)).toEqual(['superseded','analysis','proposed']);
  await expect(f.history.outcome(key,f.project.id,'layout-one','applied')).rejects.toMatchObject({code:'CONVERSATION_TURN_CLOSED'});
  await f.history.outcome(key,f.project.id,'layout-two','rejected');expect((await f.history.begin(key,f.project.id)).pendingProposal).toBeUndefined();
  expect((await f.history.outcome(key,f.project.id,'layout-two','rejected')).turns.at(-1)?.status).toBe('rejected');
  await expect(f.history.outcome(key,f.project.id,'layout-two','applied')).rejects.toMatchObject({code:'CONVERSATION_TURN_CLOSED'});
 });
 it('bounds stored proposal notes without rejecting or changing a valid detailed provider response',async()=>{
  const f=await fixture(),key=f.history.key('user-owner',f.project),value={...proposal('detailed-layout',true),issues:Array.from({length:80},(_,index)=>`Detailed geometric review ${index}`)},before=structuredClone(value);
  await append(f.history,key,f.project,value);const loaded=await f.history.begin(key,f.project.id);
  expect(loaded.pendingProposal?.issues).toHaveLength(30);expect(loaded.turns[0].issues).toHaveLength(30);expect(loaded.pendingProposal?.layout).toEqual(value.layout);expect(value).toEqual(before);
 });
 it('retains a bounded resize source marker after acceptance and rejects nonfinite or oversized marker values atomically',async()=>{
  const f=await fixture(),key=f.history.key('user-owner',f.project),roomResize={roomKey:'library',roomName:'Family library',sourceArea:21,targetArea:25.2};
  await append(f.history,key,f.project,{...proposal('resize-context',true),roomResize});await f.history.outcome(key,f.project.id,'resize-context','applied');
  const restarted=new CopilotConversationStore(new RecordStore(f.directory,Buffer.alloc(32,62)));expect((await restarted.get(key,f.project.id)).turns[0]).toMatchObject({status:'applied',roomResize});
  for(const sourceArea of [0,NaN,Infinity,1000001])await expect(append(restarted,key,f.project,{...proposal('invalid-resize',true),roomResize:{...roomResize,sourceArea}})).rejects.toThrow();
  expect((await restarted.get(key,f.project.id)).turns).toHaveLength(1);expect((await restarted.begin(key,f.project.id)).pendingProposal).toBeUndefined();
 });
 it('cannot resurrect a reset conversation with an in-flight response',async()=>{
  const f=await fixture(),key=f.history.key('user-owner',f.project),started=await f.history.begin(key,f.project.id);await f.history.reset(key,f.project.id);
  await expect(f.history.complete(key,f.project,started.epoch,proposal('late-layout',true))).rejects.toMatchObject({code:'CONVERSATION_RESET'});
  expect((await f.history.get(key,f.project.id)).turns).toEqual([]);expect((await f.history.begin(key,f.project.id)).pendingProposal).toBeUndefined();
 });
 it('uses distinct user/project/proposal scopes and caps text without mutating the source model',async()=>{
  const f=await fixture(),before=structuredClone(f.project),key=f.history.key('user-owner',f.project);
  expect(f.history.key('user-editor',f.project)).not.toBe(key);expect(f.history.key('user-owner',{...f.project,id:'other-project'})).not.toBe(key);
  const branch={...f.project,workbench:{activeProposalId:'alternative'}}as Project;expect(f.history.key('user-owner',branch)).not.toBe(key);
  await append(f.history,key,f.project,{...proposal('long-note'),summary:'s'.repeat(2000),issues:Array.from({length:35},()=> 'i'.repeat(4000))});
  const turn=(await f.history.get(key,f.project.id)).turns[0];expect(turn.summary).toHaveLength(1500);expect(turn.issues).toHaveLength(30);expect(turn.issues[0]).toHaveLength(3000);expect(f.project).toEqual(before);
 });
});
