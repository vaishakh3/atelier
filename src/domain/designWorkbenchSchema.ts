import {z} from 'zod';
import {projectSchema} from './schema';

const id=z.string().min(1).max(160),name=z.string().trim().min(1).max(120);
export const proposalSnapshotLimit=1_000_000;
/** Check nesting before project validation so a snapshot cannot recursively contain proposals. */
export function hasNestedWorkbench(value:unknown):boolean {
 if(!value||typeof value!=='object')return false;
 if(Array.isArray(value))return value.some(hasNestedWorkbench);
 return Object.entries(value).some(([key,item])=>key==='workbench'||hasNestedWorkbench(item));
}
export const workbenchSchema=z.object({
 schemaVersion:z.literal(1),activeProposalId:id,
 proposals:z.array(z.object({id,name,modelJson:z.string().min(2).max(proposalSnapshotLimit).refine(value=>new TextEncoder().encode(value).byteLength<=proposalSnapshotLimit,'The proposal snapshot exceeds 1 MB of UTF-8 data.')}).strict()).min(1).max(6),
 layers:z.array(z.object({id,name,kind:z.enum(['design','context']),elementIds:z.array(id).max(10000),visible:z.boolean(),locked:z.boolean(),managedLockIds:z.array(id).max(10000).optional()}).strict()).max(40),
}).strict().superRefine((state,context)=>{
 if(new Set(state.proposals.map(proposal=>proposal.id)).size!==state.proposals.length)context.addIssue({code:'custom',message:'Proposal IDs must be unique.'});
 if(!state.proposals.some(proposal=>proposal.id===state.activeProposalId))context.addIssue({code:'custom',message:'The active design proposal is unavailable.'});
 if(new Set(state.layers.map(layer=>layer.id)).size!==state.layers.length)context.addIssue({code:'custom',message:'Layer IDs must be unique.'});
 const assigned=new Set<string>();
 for(const layer of state.layers){
  if(new Set(layer.elementIds).size!==layer.elementIds.length)context.addIssue({code:'custom',message:'Layer membership contains duplicate IDs.'});
  for(const elementId of layer.elementIds){const key=`${layer.kind}:${elementId}`;if(assigned.has(key))context.addIssue({code:'custom',message:'Each design element or context asset can belong to one layer.'});assigned.add(key);}
  if(layer.managedLockIds?.some(id=>!layer.elementIds.includes(id)))context.addIssue({code:'custom',message:'Managed locks must belong to their layer.'});
 }
 for(const proposal of state.proposals){
  try{
   const raw:unknown=JSON.parse(proposal.modelJson);
   if(hasNestedWorkbench(raw)){context.addIssue({code:'custom',message:'Proposal snapshots cannot contain a nested workbench.'});continue;}
   // Deferred callback: schema.ts imports this schema; no project validation runs during initialization.
   if(!projectSchema.safeParse(raw).success)context.addIssue({code:'custom',message:`${proposal.name}: invalid project snapshot.`});
  }catch{context.addIssue({code:'custom',message:`${proposal.name}: invalid proposal JSON.`});}
 }
});
