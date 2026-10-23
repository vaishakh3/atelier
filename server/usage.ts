import {z} from 'zod';
import {ApiError} from './errors';
import {RecordStore} from './storage';

export const usageEvents=['project_created','import_completed','ai_proposed','ai_accepted','ai_rejected','undo','document_exported','scenario_compared','scenario_adopted','snapshot_published'] as const;
export type UsageEvent=typeof usageEvents[number];
const MAX_COUNT=1_000_000_000;
const MAX_TOTAL_MS=Number.MAX_SAFE_INTEGER;
const counter=z.number().int().min(0).max(MAX_COUNT);
const duration=z.object({total:z.number().int().min(0).max(MAX_TOTAL_MS),samples:counter}).strict();
const countsSchema=z.object(Object.fromEntries(usageEvents.map(event=>[event,counter])) as Record<UsageEvent,typeof counter>).strict();
const durationsSchema=z.object(Object.fromEntries(usageEvents.map(event=>[event,duration])) as Record<UsageEvent,typeof duration>).strict();
const recordSchema=z.object({schemaVersion:z.literal(1),counts:countsSchema,durationMs:durationsSchema}).strict();
export const usageRequestSchema=z.object({event:z.enum(usageEvents),projectId:z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/).optional(),durationMs:z.number().int().min(0).max(86_400_000).optional()}).strict();
type UsageRecord=z.infer<typeof recordSchema>;
function empty():UsageRecord{return{schemaVersion:1,counts:Object.fromEntries(usageEvents.map(event=>[event,0])) as UsageRecord['counts'],durationMs:Object.fromEntries(usageEvents.map(event=>[event,{total:0,samples:0}])) as UsageRecord['durationMs']};}

/** Local aggregate counters only. No event rows, user/project identifiers, or content are retained. */
export class UsageService{
  private attempts=new Map<string,{count:number;until:number}>();
  constructor(private store:RecordStore){}
  private async read(){try{return await this.store.read('usage',value=>recordSchema.parse(value));}catch(error){if(error instanceof ApiError&&error.code==='NOT_FOUND')return empty();throw error;}}
  async snapshot(){const {counts,durationMs}=await this.read();return{counts,durationMs};}
  async increment(event:UsageEvent,durationMs:number|undefined,userId:string){
    const now=Date.now();for(const [id,entry]of this.attempts)if(entry.until<=now)this.attempts.delete(id);const entry=this.attempts.get(userId)??{count:0,until:now+60_000};
    if(entry.count>=240)throw new ApiError(429,'USAGE_RATE_LIMIT','Too many local usage events. Retry after one minute.');entry.count++;this.attempts.set(userId,entry);
    await this.store.transaction('usage',async()=>{const record=await this.read();record.counts[event]=Math.min(MAX_COUNT,record.counts[event]+1);if(durationMs!==undefined){record.durationMs[event].samples=Math.min(MAX_COUNT,record.durationMs[event].samples+1);record.durationMs[event].total=Math.min(MAX_TOTAL_MS,record.durationMs[event].total+durationMs);}await this.store.write('usage',record);});
  }
}
