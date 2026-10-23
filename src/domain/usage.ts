import {apiFetch} from './api';
export type UsageEvent='project_created'|'import_completed'|'ai_proposed'|'ai_accepted'|'ai_rejected'|'undo'|'document_exported'|'scenario_compared'|'scenario_adopted'|'snapshot_published';
/** Local encrypted aggregate counters only. Never include prompts, model values or credentials. */
export function recordUsage(event:UsageEvent,projectId?:string,durationMs?:number){void apiFetch('/api/usage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,...(projectId?{projectId}:{}),...(durationMs!==undefined?{durationMs:Math.min(86400000,Math.max(0,Math.round(durationMs)))}:{})})}).catch(()=>{});}
