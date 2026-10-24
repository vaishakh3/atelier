import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {AiProposal,Project} from '../src/domain/types';
import type {CopilotConversation,CopilotTurn} from '../src/domain/copilotConversation';
import {layoutProposalSchema,localRoomEditProposalSchema,upperFloorProposalSchema} from './schema';
import {ApiError} from './errors';
import {digest,RecordStore} from './storage';

const id=z.string().min(1).max(160),kind=z.enum(['edit','analysis','schedule','repetition','layout']);
const roomResizeSchema=z.object({roomKey:z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),roomName:z.string().min(1).max(3000),sourceArea:z.number().finite().positive().max(1000000),targetArea:z.number().finite().positive().max(1000000)}).strict();
const turnSchema=z.object({id,prompt:z.string().max(4000),summary:z.string().max(1500),issues:z.array(z.string().max(3000)).max(30),kind,selectedIds:z.array(id).max(1000),status:z.enum(['proposed','applied','rejected','superseded','analysis']),projectVersion:z.number().int().nonnegative(),createdAt:z.string().datetime(),layout:layoutProposalSchema.optional(),localEdit:localRoomEditProposalSchema.optional(),upperFloor:upperFloorProposalSchema.optional(),roomResize:roomResizeSchema.optional()}).strict();
const pendingSchema=z.custom<AiProposal>(value=>{
 if(!value||typeof value!=='object')return false;
 const proposal=value as AiProposal;
 try{return id.safeParse(proposal.id).success&&kind.safeParse(proposal.kind).success&&typeof proposal.prompt==='string'&&proposal.prompt.length<=4000&&typeof proposal.summary==='string'&&proposal.summary.length<=1500&&Array.isArray(proposal.changes)&&proposal.changes.length<=1000&&Array.isArray(proposal.issues)&&proposal.issues.length<=30&&Array.isArray(proposal.selectedIds)&&proposal.selectedIds.length<=1000&&(!proposal.layout||layoutProposalSchema.safeParse(proposal.layout).success)&&(!proposal.localEdit||localRoomEditProposalSchema.safeParse(proposal.localEdit).success)&&(!proposal.upperFloor||upperFloorProposalSchema.safeParse(proposal.upperFloor).success)&&(!proposal.roomResize||roomResizeSchema.safeParse(proposal.roomResize).success)&&Buffer.byteLength(JSON.stringify(proposal),'utf8')<=2*1024*1024;}catch{return false;}
},'Invalid bounded pending proposal');
const recordSchema=z.object({projectId:id,epoch:z.string().uuid(),turns:z.array(turnSchema).max(12),pendingProposal:pendingSchema.optional()}).strict().superRefine((value,context)=>{
 if(new Set(value.turns.map(turn=>turn.id)).size!==value.turns.length)context.addIssue({code:'custom',message:'Duplicate conversation turn'});
 if(value.turns.filter(turn=>turn.status==='proposed').length>1)context.addIssue({code:'custom',message:'Only one proposal can await review'});
});
interface ConversationRecord {projectId:string;epoch:string;turns:CopilotTurn[];pendingProposal?:AiProposal}
export const activeConversationBranch=(project:Project)=>project.workbench?.activeProposalId??null;
export class CopilotConversationStore {
 private memory=new Map<string,ConversationRecord>();private queues=new Map<string,Promise<void>>();
 constructor(private store?:RecordStore){}
 get persistent(){return!!this.store;}
 private async transaction<T>(key:string,action:()=>Promise<T>):Promise<T>{
  if(this.store)return this.store.transaction(key,action);
  const previous=this.queues.get(key)??Promise.resolve();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),queued=previous.then(()=>gate);this.queues.set(key,queued);await previous;
  try{return await action();}finally{release();if(this.queues.get(key)===queued)this.queues.delete(key);}
 }
 private async write(key:string,value:ConversationRecord){
  const checked=recordSchema.parse(value)as ConversationRecord;if(this.store)return this.store.write(key,checked);
  this.memory.delete(key);this.memory.set(key,structuredClone(checked));if(this.memory.size>256)this.memory.delete(this.memory.keys().next().value!);
 }
 key(userId:string,project:Project,branchId=activeConversationBranch(project)){return`copilot:${project.id}:${digest(JSON.stringify([userId,project.id,branchId]))}`;}
 private async read(key:string,projectId:string):Promise<ConversationRecord>{
  try{const record=this.store?await this.store.read(key,value=>recordSchema.parse(value)as ConversationRecord,{recover:false}):this.memory.get(key);if(!record)return{projectId,epoch:randomUUID(),turns:[]};if(record.projectId!==projectId)throw new ApiError(503,'CONVERSATION_INTEGRITY','Conversation belongs to another project');return structuredClone(record);}
  catch(error){if(error instanceof ApiError&&error.code==='NOT_FOUND')return{projectId,epoch:randomUUID(),turns:[]};throw error;}
 }
 async begin(key:string,projectId:string){return this.transaction(key,async()=>{const record=await this.read(key,projectId);await this.write(key,record);return structuredClone(record);});}
 async get(key:string,projectId:string):Promise<CopilotConversation>{const record=await this.read(key,projectId);return{projectId,turns:record.turns};}
 async reset(key:string,projectId:string):Promise<CopilotConversation>{return this.transaction(key,async()=>{await this.write(key,{projectId,epoch:randomUUID(),turns:[]});return{projectId,turns:[]};});}
 async complete(key:string,project:Project,epoch:string,proposal:AiProposal){return this.transaction(key,async()=>{
  const record=await this.read(key,project.id);if(record.epoch!==epoch)throw new ApiError(409,'CONVERSATION_RESET','The conversation was reset while this request was running. Retry in the new conversation.');
  const mutating=proposal.changes.length>0||!!proposal.layout||!!proposal.repetition||!!proposal.creations?.length||proposal.crewCount!==undefined||!!proposal.localEdit||!!proposal.upperFloor||!!proposal.removals?.length;
  if(mutating){for(const turn of record.turns)if(turn.status==='proposed')turn.status='superseded';record.pendingProposal={...structuredClone(proposal),issues:proposal.issues.slice(0,30).map(issue=>issue.slice(0,3000))};}
  const turn:CopilotTurn={id:proposal.id,prompt:proposal.prompt.slice(0,4000),summary:proposal.summary.slice(0,1500),issues:proposal.issues.slice(0,30).map(issue=>issue.slice(0,3000)),kind:proposal.kind,selectedIds:proposal.selectedIds.slice(0,1000),status:mutating?'proposed':'analysis',projectVersion:project.version,createdAt:proposal.createdAt,...(proposal.layout?{layout:structuredClone(proposal.layout)}:{}),...(proposal.localEdit?{localEdit:localRoomEditProposalSchema.parse(proposal.localEdit)}:{}),...(proposal.upperFloor?{upperFloor:upperFloorProposalSchema.parse(proposal.upperFloor)}:{}),...(proposal.roomResize?{roomResize:roomResizeSchema.parse(proposal.roomResize)}:{})};
  record.turns=[...record.turns,turn].slice(-12);await this.write(key,record);return turn;
 });}
 async outcome(key:string,projectId:string,turnId:string,status:'applied'|'rejected'):Promise<CopilotConversation>{return this.transaction(key,async()=>{
  const record=await this.read(key,projectId),turn=record.turns.find(turn=>turn.id===turnId);
  if(!turn)throw new ApiError(404,'NOT_FOUND','Conversation turn not found');
  if(turn.status===status)return{projectId,turns:record.turns};
  if(turn.status!=='proposed')throw new ApiError(409,'CONVERSATION_TURN_CLOSED','This proposal is no longer awaiting review');
  // This records review intent only. It never applies geometry or bypasses save guards.
  turn.status=status;if(record.pendingProposal?.id===turnId)delete record.pendingProposal;
  await this.write(key,record);return{projectId,turns:record.turns};
 });}
}
