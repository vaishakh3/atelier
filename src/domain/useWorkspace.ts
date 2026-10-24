import {recordUsage} from './usage';
import {apiFetch} from './api';
import {resolveStartupProject} from './startup';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Project,SavedVersion,ReviewComment,Role} from './types';
import {createDemoProject,createBlankProject} from './seed';
import {auditProject} from './transactions';
import {invalidateScheduleReview} from '../engine/modelImpact';
import {projectSchema} from './schema';
import {DEFAULT_AI_MODEL} from './aiConfig';
const CACHE='atelier-project-v1';
interface Options {identityRequired?:boolean;userId?:string;authenticated?:boolean}
function initial(identityRequired:boolean){if(!identityRequired){try{const text=localStorage.getItem(CACHE);if(text){const result=projectSchema.safeParse(JSON.parse(text));if(result.success)return {project:result.data as Project,recovered:true};}}catch{}}return {project:createDemoProject(),recovered:false};}
export function useWorkspace({identityRequired=false,userId,authenticated=true}:Options={}){
 const [boot]=useState(()=>initial(identityRequired));
 const [project,setProject]=useState<Project>(boot.project),[projects,setProjects]=useState<Project[]>([]),[saved,setSaved]=useState('Connecting…'),[ready,setReady]=useState(false),[aiReady,setAiReady]=useState(false),[aiModel,setAiModel]=useState(DEFAULT_AI_MODEL),[versions,setVersions]=useState<SavedVersion[]>([]),[comments,setComments]=useState<ReviewComment[]>([]),[error,setError]=useState(''),[tick,setTick]=useState(0),[historyEpoch,setHistoryEpoch]=useState(0),[transitioning,setTransitioning]=useState(false),[permissions,setPermissions]=useState<Record<string,Role>>({}),[warnings,setWarnings]=useState<string[]>([]),[recoveryCopy,setRecoveryCopy]=useState<Project|null>(null);
 const undo=useRef<Project[]>([]),redo=useRef<Project[]>([]),active=useRef(project),queue=useRef<Promise<void>>(Promise.resolve()),disposed=useRef(false),transition=useRef(false),viewEpoch=useRef(0),persisted=useRef(new Map<string,string>()),submitted=useRef(new Map<string,string>()),etags=useRef(new Map<string,string>()),debounce=useRef<ReturnType<typeof setTimeout>|null>(null),auth=useRef(authenticated),actor=useRef(userId||'local-author');
 active.current=project;auth.current=authenticated;actor.current=userId||'local-author';
 const writable=useRef(false);
 const currentRole:Role=identityRequired?(permissions[project.id]||(persisted.current.has(project.id)?'reviewer':'admin')):'admin';
 writable.current=ready&&authenticated&&!recoveryCopy&&!transition.current&&currentRole!=='reviewer';
 const beginTransition=()=>{if(disposed.current||!auth.current||transition.current)return false;transition.current=true;writable.current=false;setTransitioning(true);return true;};
 const endTransition=()=>{transition.current=false;if(!disposed.current)setTransitioning(false);};
 useEffect(()=>{disposed.current=false;auth.current=authenticated;return()=>{disposed.current=true;auth.current=false;writable.current=false;if(debounce.current)clearTimeout(debounce.current);};},[]);
 const persist=useCallback(async(value:Project)=>{
  if(disposed.current)throw new Error('This workspace is closed. Reopen the project before saving.');
  if(!auth.current)throw new Error('Sign in again to save your changes.');
  const body=JSON.stringify(value);
  if(persisted.current.get(value.id)===body||submitted.current.get(value.id)===body){setSaved('Saved locally');return;}
  const headers:Record<string,string>={'Content-Type':'application/json'};const etag=etags.current.get(value.id);if(etag)headers['If-Match']=etag;
  let created=false;let response=await apiFetch('/api/projects/'+value.id,{method:'PUT',headers,body});
  if(response.status===404&&!persisted.current.has(value.id)&&!etags.current.has(value.id)){response=await apiFetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body});created=response.ok;}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'The local project save was rejected.');
  if(disposed.current)return;
  if(created)recordUsage('project_created',value.id);
  const canonical=(data.project||value) as Project;if(data.etag)etags.current.set(value.id,data.etag);
  persisted.current.set(value.id,JSON.stringify(canonical));submitted.current.set(value.id,body);
  if(data.role)setPermissions(previous=>({...previous,[value.id]:data.role}));
  // Keep edits made while the request was running; only reconcile its exact input.
  if(active.current.id===value.id&&JSON.stringify(active.current)===body){active.current=canonical;setProject(canonical);}
  setSaved('Saved locally');setError('');setProjects(previous=>[canonical,...previous.filter(p=>p.id!==canonical.id)]);

 },[identityRequired]);
 const save=useCallback((value:Project)=>{const result=queue.current.then(()=>persist(value));queue.current=result.catch(()=>{});return result;},[persist]);
 const flush=useCallback(async()=>{if(debounce.current){clearTimeout(debounce.current);debounce.current=null;}await save(active.current);},[save]);
 useEffect(()=>{let alive=true;(async()=>{try{
  const health=await apiFetch('/api/health').then(r=>r.json());if(alive){setAiReady(Boolean(health.aiReady));if(typeof health.model==='string')setAiModel(health.model);}
  if(!identityRequired){const session=await fetch('/api/session',{method:'POST',credentials:'same-origin'});if(!session.ok)throw new Error('Local session unavailable');}
  const response=await apiFetch('/api/projects');if(!response.ok)throw new Error('Project access is unavailable.');const data=await response.json();
  if(!alive)return;const valid=(data.projects||[]).filter((p:unknown)=>projectSchema.safeParse(p).success) as Project[];
  setProjects(valid);setPermissions(data.permissions||{});setWarnings(data.warnings||[]);
  for(const item of valid){persisted.current.set(item.id,JSON.stringify(item));if(data.etags?.[item.id])etags.current.set(item.id,data.etags[item.id]);}
  let next=resolveStartupProject(active.current,valid,boot.recovered);
  if(identityRequired&&valid.length===0)next=createBlankProject('Untitled project');
  if(identityRequired&&valid.some(p=>p.id===next.id)){
   const recovered=await apiFetch('/api/recovery/'+next.id).then(r=>r.ok?r.json():null).catch(()=>null);const parsed=projectSchema.safeParse(recovered?.recovery?.project);
   if(parsed.success&&parsed.data.version>next.version){if(recovered.recovery.baseEtag===etags.current.get(next.id)){next=parsed.data as Project;setWarnings(previous=>[...previous,'A newer encrypted recovery copy was restored. Review it before saving.']);}else{setRecoveryCopy(parsed.data as Project);setWarnings(previous=>[...previous,'A recovery draft conflicts with a newer saved revision. Export that recovery copy before making further changes.']);}}
  }
  if(alive){active.current=next;setProject(next);setReady(true);}
 }catch{if(alive){setSaved('Save needs attention');setError('The local project engine is unavailable. Reopen the app or export a recovery copy before closing.');}}})();return()=>{alive=false;};},[boot.recovered,identityRequired]);
 useEffect(()=>{
  // Production model data never enters plaintext renderer localStorage.
  if(!identityRequired){try{localStorage.setItem(CACHE,JSON.stringify(project));}catch{setError('Recovery storage is full. Export a project copy.');}}
  if(!ready||!authenticated||recoveryCopy)return;
  if(identityRequired&&currentRole==='reviewer'){setSaved('Read-only project');return;}
  const unchanged=persisted.current.get(project.id)===JSON.stringify(project);if(unchanged){setSaved('Saved locally');return;}
  setSaved('Saving…');
  const recovery=identityRequired&&etags.current.has(project.id)?setTimeout(()=>{void apiFetch('/api/recovery/'+project.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,baseEtag:etags.current.get(project.id)})}).catch(()=>{});},180):null;
  debounce.current=setTimeout(()=>{debounce.current=null;save(project).catch(e=>{setSaved('Save needs attention');setError((e instanceof Error?e.message:'Save failed')+'. Keep this project open or export a copy before closing.');});},650);
  return()=>{if(debounce.current){clearTimeout(debounce.current);debounce.current=null;}if(recovery)clearTimeout(recovery);};
 },[project,ready,save,identityRequired,authenticated,currentRole,recoveryCopy]);
 useEffect(()=>{if(!ready||!authenticated)return;let live=true;setVersions([]);setComments([]);Promise.all([apiFetch('/api/projects/'+project.id+'/versions').then(r=>r.ok?r.json():{versions:[]}),apiFetch('/api/projects/'+project.id+'/comments').then(r=>r.ok?r.json():{comments:[]})]).then(([v,c])=>{if(live){setVersions(v.versions||[]);setComments(c.comments||[]);}}).catch(()=>{});return()=>{live=false;};},[project.id,ready,authenticated,historyEpoch]);
 const commit=useCallback((next:Project|((p:Project)=>Project),action:string,ids:string[]=[])=>{
  if(!writable.current)return false;
  const previous=active.current,result=invalidateScheduleReview(previous,typeof next==='function'?next(previous):next),parsed=projectSchema.safeParse(result);
  if(!parsed.success){setError('The proposed project state is invalid. No changes were applied.');return false;}
  undo.current.push(structuredClone(previous));undo.current=undo.current.slice(-60);redo.current=[];
  const value=auditProject({...result,version:previous.version,audit:previous.audit},action,ids,actor.current);active.current=value;setProject(value);setTick(x=>x+1);return true;
 },[]);
 const historyAction=(direction:'undo'|'redo')=>{if(!writable.current)return;const source=direction==='undo'?undo:redo,destination=direction==='undo'?redo:undo;const next=source.current.pop();if(!next)return;const now=active.current;destination.current.push(structuredClone(now));const value=auditProject({...next,version:now.version,audit:now.audit},direction==='undo'?'Undo transaction':'Redo transaction',[],actor.current);active.current=value;setProject(value);setTick(x=>x+1);};
 const undoAction=()=>{if(writable.current&&undo.current.length)recordUsage('undo',active.current.id);historyAction('undo');},redoAction=()=>historyAction('redo');
 const switchProject=async(next:Project)=>{
  if(!auth.current||transition.current)return false;
  if(!projectSchema.safeParse(next).success){setError('Cannot open an invalid project.');return false;}
  if(recoveryCopy){setError('Resolve or export the conflicting recovery draft before opening another project.');return false;}
  if(!beginTransition())return false;
  try{
   if(ready&&currentRole!=='reviewer')await flush();
   let incoming=next;let conflict:Project|null=null;
   if(persisted.current.has(next.id)){
    const response=await apiFetch('/api/projects/'+next.id),data=await response.json();if(!response.ok)throw new Error(data.error||'Project access is unavailable.');incoming=data.project;
    persisted.current.set(next.id,JSON.stringify(incoming));submitted.current.delete(next.id);if(data.etag)etags.current.set(next.id,data.etag);if(data.role)setPermissions(previous=>({...previous,[next.id]:data.role}));
    if(identityRequired){const recovered=await apiFetch('/api/recovery/'+next.id).then(r=>r.ok?r.json():null);const parsed=projectSchema.safeParse(recovered?.recovery?.project);if(parsed.success&&parsed.data.version>incoming.version){if(recovered.recovery.baseEtag===data.etag)incoming=parsed.data as Project;else conflict=parsed.data as Project;}}
   }
   if(disposed.current||!auth.current)return false;
   viewEpoch.current++;setHistoryEpoch(value=>value+1);undo.current=[];redo.current=[];setRecoveryCopy(conflict);active.current=incoming;setProject(structuredClone(incoming));setTick(x=>x+1);setError('');return true;
  }catch(e){setError((e instanceof Error?e.message:'Could not open this project.')+' The current project remains open.');return false;}finally{endTransition();}
 };
 const newProject=(name:string)=>switchProject(createBlankProject(name));
 const publish=async(label:string)=>{
  if(!beginTransition())throw new Error('Finish the current project operation before publishing.');
  try{await flush();const current=active.current,epoch=viewEpoch.current,response=await apiFetch('/api/projects/'+current.id+'/versions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label,project:current})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not publish snapshot');if(!disposed.current&&auth.current&&active.current.id===current.id&&viewEpoch.current===epoch)setVersions(previous=>[data.version,...previous.filter(item=>item.id!==data.version.id)]);recordUsage('snapshot_published',current.id);return data.version as SavedVersion;}finally{endTransition();}
 };
 const restore=(version:SavedVersion)=>commit({...structuredClone(version.project),id:project.id,version:project.version},'Restored snapshot: '+version.label);
 const addComment=async(versionId:string,text:string)=>{const projectId=active.current.id,epoch=viewEpoch.current;const response=await apiFetch('/api/projects/'+projectId+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({versionId,text})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not add comment');if(!disposed.current&&auth.current&&active.current.id===projectId&&viewEpoch.current===epoch)setComments(previous=>[data.comment,...previous.filter(item=>item.id!==data.comment.id)]);};
 const refresh=async(discardLocalChanges=false)=>{
  if(!discardLocalChanges&&persisted.current.get(active.current.id)!==JSON.stringify(active.current))throw new Error('Local edits are unsaved. Save or export them before reloading the project.');
  if(!beginTransition())throw new Error('Finish the current project operation before refreshing.');
  if(debounce.current){clearTimeout(debounce.current);debounce.current=null;}
  try{
   await queue.current;
   const original=active.current.id,body=JSON.stringify(active.current);
   const response=await apiFetch('/api/projects'),data=await response.json();if(!response.ok)throw new Error(data.error||'Could not refresh project access');
   if(disposed.current||!auth.current)return;
   if(active.current.id!==original||JSON.stringify(active.current)!==body)throw new Error('The project changed while refreshing. Your local edits were kept.');
   const list=(data.projects||[]).filter((item:unknown)=>projectSchema.safeParse(item).success) as Project[];setProjects(list);setPermissions(data.permissions||{});setWarnings(data.warnings||[]);
   for(const item of list){persisted.current.set(item.id,JSON.stringify(item));submitted.current.delete(item.id);if(data.etags?.[item.id])etags.current.set(item.id,data.etags[item.id]);}
   let next=list.find(item=>item.id===original)||list[0]||createBlankProject('Untitled project');let conflict:Project|null=null;if(identityRequired&&list.some(item=>item.id===next.id)){const recovered=await apiFetch('/api/recovery/'+next.id).then(r=>r.ok?r.json():null);const parsed=projectSchema.safeParse(recovered?.recovery?.project);if(parsed.success&&parsed.data.version>next.version){if(recovered.recovery.baseEtag===etags.current.get(next.id))next=parsed.data as Project;else conflict=parsed.data as Project;}}if(disposed.current||!auth.current)return;viewEpoch.current++;setHistoryEpoch(value=>value+1);active.current=next;setProject(next);undo.current=[];redo.current=[];setRecoveryCopy(conflict);setError('');
  }finally{endTransition();}
 };
 const clearRecoveryCopy=async()=>{const response=await apiFetch('/api/recovery/'+active.current.id,{method:'DELETE'});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'The recovery copy could not be cleared.');}setRecoveryCopy(null);};
 return {project,projects,commit,switchProject,newProject,saved,ready,transitioning,aiReady,aiModel,versions,comments,publish,restore,addComment,error,setError,undoAction,redoAction,canUndo:undo.current.length>0,canRedo:redo.current.length>0,tick,flush,getCurrentProject:()=>structuredClone(active.current),currentRole,warnings,recoveryCopy,clearRecoveryCopy,refresh,getEtag:()=>etags.current.get(active.current.id)};
}
