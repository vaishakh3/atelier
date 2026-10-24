import type {z} from 'zod';
import type {BimElement,Project,Role} from './types';
import {projectSchema} from './schema';
import {hasNestedWorkbench,proposalSnapshotLimit,workbenchSchema} from './designWorkbenchSchema';

export type DesignWorkbenchState=z.infer<typeof workbenchSchema>;
export type DesignLayer=DesignWorkbenchState['layers'][number];
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const uuid=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;
export const terrainContextId='site-terrain';

function author(project:Project,role:Role){
 if(role!=='admin'&&role!=='editor')throw new Error('Editor or administrator access is required to manage design proposals and layers.');
 if(project.constraints.lockedProperties.some(lock=>lock==='*'||lock==='workbench'||lock==='workbench.*'||lock==='model.workbench'||lock.startsWith('workbench.')))throw new Error('The design workbench is locked.');
}
function snapshot(project:Project):string{
 // Site/context is a shared live base, not duplicated into every architectural branch.
 const {workbench:_workbench,site:_site,...model}=project;
 const json=JSON.stringify(model);
 if(json.length>proposalSnapshotLimit||new TextEncoder().encode(json).byteLength>proposalSnapshotLimit)throw new Error('This architectural proposal exceeds the 1 MB snapshot limit. Simplify its model or split the project before creating or switching proposals. Shared site assets are stored separately.');
 if(hasNestedWorkbench(model))throw new Error('A design snapshot cannot contain nested workbench data.');
 if(!projectSchema.safeParse(model).success)throw new Error('The current project cannot be preserved as a valid design snapshot.');
 return json;
}
export function parseDesignSnapshot(modelJson:string):Project{
 if(modelJson.length>proposalSnapshotLimit||new TextEncoder().encode(modelJson).byteLength>proposalSnapshotLimit)throw new Error('The design snapshot exceeds the 1 MB limit.');
 let raw:unknown;try{raw=JSON.parse(modelJson);}catch{throw new Error('The design snapshot is not valid JSON.');}
 if(hasNestedWorkbench(raw))throw new Error('The design snapshot contains a nested workbench.');
 const parsed=projectSchema.safeParse(raw);
 if(!parsed.success)throw new Error('The design snapshot has unsupported or invalid project data.');
 return parsed.data;
}
function stateFor(project:Project):DesignWorkbenchState{
 if(project.workbench){const parsed=workbenchSchema.safeParse(project.workbench);if(!parsed.success)throw new Error('The saved design workbench is invalid.');return structuredClone(parsed.data);}
 const id=uuid('proposal');
 return{schemaVersion:1,activeProposalId:id,proposals:[{id,name:'Original design',modelJson:snapshot(project)}],layers:[]};
}
function saveCurrent(project:Project,state:DesignWorkbenchState):DesignWorkbenchState{
 const next=structuredClone(state),active=next.proposals.find(proposal=>proposal.id===next.activeProposalId);
 if(!active)throw new Error('The active proposal is missing.');
 active.modelJson=snapshot(project);
 return next;
}
export function initializeDesignWorkbench(project:Project,role:Role):Project{
 author(project,role);return{...structuredClone(project),workbench:stateFor(project)};
}
export function createDesignProposal(project:Project,name:string,role:Role):Project{
 author(project,role);
 const cleaned=name.trim();if(!cleaned||cleaned.length>120)throw new Error('Enter a proposal name of 1–120 characters.');
 const state=saveCurrent(project,stateFor(project));
 if(state.proposals.length>=6)throw new Error('This project already has the six supported design proposals.');
 const id=uuid('proposal');state.proposals.push({id,name:cleaned,modelJson:snapshot(project)});state.activeProposalId=id;
 return{...structuredClone(project),workbench:state};
}
export function renameDesignProposal(project:Project,id:string,name:string,role:Role):Project{
 author(project,role);const cleaned=name.trim();if(!cleaned||cleaned.length>120)throw new Error('Enter a proposal name of 1–120 characters.');
 const state=stateFor(project),proposal=state.proposals.find(proposal=>proposal.id===id);if(!proposal)throw new Error('The design proposal no longer exists.');proposal.name=cleaned;
 return{...structuredClone(project),workbench:state};
}

/** Match both project paths and the element-ID paths used by the existing design controls. */
function elementChangeLocked(project:Project,before:BimElement|undefined,after:BimElement|undefined):boolean{
 const id=before?.id??after!.id,locks=project.constraints.lockedProperties;
 if(equal(before,after))return false;
 if(project.constraints.lockedElementIds.includes(id))return true;
 const broad=['*','elements','elements.*','model.elements','model.elements.*',`${id}.*`,`elements.${id}`,`elements.${id}.*`,`model.elements.${id}`,`model.elements.${id}.*`];
 if(locks.some(lock=>broad.includes(lock)))return true;
 const changed=[...new Set([...Object.keys(before??{}),...Object.keys(after??{})])].filter(key=>!equal(before?.[key as keyof BimElement],after?.[key as keyof BimElement]));
 if(changed.includes('properties'))for(const key of new Set([...Object.keys(before?.properties??{}),...Object.keys(after?.properties??{})]))if(!equal(before?.properties[key],after?.properties[key]))changed.push(`properties.${key}`,key,'properties.*');
 if(changed.some(key=>['x','y','z','rotation','width','depth','height','footprint'].includes(key)))changed.push('geometry','geometry.*','position','position.*','dimensions','dimensions.*');
 return locks.some(lock=>changed.some(field=>[field,`model.${field}`,`${id}.${field}`,`elements.${field}`,`elements.${id}.${field}`,`elements.*.${field}`,`model.elements.${field}`,`model.elements.*.${field}`,`model.elements.${id}.${field}`].includes(lock)));
}
export function assertDesignSwitchUnlocked(project:Project,candidate:Project):void{
 const old=new Map(project.elements.map(element=>[element.id,element])),next=new Map(candidate.elements.map(element=>[element.id,element]));
 for(const id of new Set([...old.keys(),...next.keys()])){
  const before=old.get(id),after=next.get(id);
  if(!equal(before,after)&&before&&!before.editable)throw new Error(`${before.name} is a read-only reference and differs in this proposal.`);
  if(elementChangeLocked(project,before,after))throw new Error(`A locked element or property (${before?.name??after?.name??id}) differs in this proposal. Unlock it explicitly before switching.`);
 }
 for(const field of ['levels','grids','types','allowances','schedule','planning','services','units','currency','designLibrary']as const)if(!equal(project[field],candidate[field])&&project.constraints.lockedProperties.some(lock=>lock===field||lock===`${field}.*`||lock.startsWith(`${field}.`)||lock===`model.${field}`||lock.startsWith(`model.${field}.`)))throw new Error(`The ${field} data is locked and differs in this proposal.`);
}
export function switchDesignProposal(project:Project,id:string,role:Role):Project{
 author(project,role);const state=saveCurrent(project,stateFor(project)),proposal=state.proposals.find(proposal=>proposal.id===id);
 if(!proposal)throw new Error('The design proposal no longer exists.');
 if(id===state.activeProposalId)return{...structuredClone(project),workbench:state};
 const saved=parseDesignSnapshot(proposal.modelJson);
 // Identity, audit and authorization constraints are live workspace state. Shared site base never rolls back.
 const candidate:Project={...saved,id:project.id,name:project.name,createdAt:project.createdAt,updatedAt:project.updatedAt,version:project.version,audit:structuredClone(project.audit),constraints:structuredClone(project.constraints),workbench:{...state,activeProposalId:id}};
 if(project.site)candidate.site=structuredClone(project.site);else delete candidate.site;
 assertDesignSwitchUnlocked(project,candidate);
 if(!equal(project.elements,candidate.elements)||!equal(project.types,candidate.types)||!equal(project.services,candidate.services)){
  candidate.schedule={...candidate.schedule,modelReviewRequired:true};delete candidate.schedule.modelReview;
  candidate.schedule.sequenceAlternatives=candidate.schedule.sequenceAlternatives?.map(alternative=>({...alternative,approved:false}));
 }
 if(!projectSchema.safeParse(candidate).success)throw new Error('The restored proposal does not satisfy the complete project schema.');
 return structuredClone(candidate);
}
export function proposalProject(project:Project,id:string):Project{
 if(project.workbench?.activeProposalId===id)return structuredClone(project);
 const proposal=project.workbench?.proposals.find(proposal=>proposal.id===id);if(!proposal)throw new Error('The design proposal is unavailable.');
 const saved=parseDesignSnapshot(proposal.modelJson);
 if(project.site)saved.site=structuredClone(project.site);else delete saved.site;
 return saved;
}

function layerState(project:Project,role:Role){author(project,role);return stateFor(project);}
export function createDesignLayer(project:Project,name:string,kind:DesignLayer['kind'],role:Role):Project{
 const state=layerState(project,role),cleaned=name.trim();if(!cleaned||cleaned.length>120)throw new Error('Enter a layer name of 1–120 characters.');
 if(state.layers.length>=40)throw new Error('This project already has the 40 supported layers.');
 state.layers.push({id:uuid('layer'),name:cleaned,kind,elementIds:[],visible:true,locked:false,managedLockIds:[]});
 return{...structuredClone(project),workbench:state};
}
export function assignDesignLayer(project:Project,layerId:string,ids:string[],role:Role):Project{
 const state=layerState(project,role),layer=state.layers.find(layer=>layer.id===layerId);if(!layer)throw new Error('The layer no longer exists.');
 if(layer.locked)throw new Error('Unlock the destination layer before assigning elements.');
 const valid=new Set(layer.kind==='design'?project.elements.map(element=>element.id):[...(project.site?.contexts.map(asset=>asset.id)??[]),...(project.site?.terrain?[terrainContextId]:[])]);
 const unique=[...new Set(ids)];if(unique.some(id=>!valid.has(id)))throw new Error('Choose existing architectural elements or context assets of the matching layer kind.');
 for(const previous of state.layers.filter(other=>other.kind===layer.kind))if(previous.locked&&previous.elementIds.some(id=>unique.includes(id)))throw new Error('Unlock the source layer before moving its members.');
 for(const previous of state.layers.filter(other=>other.kind===layer.kind))previous.elementIds=previous.elementIds.filter(id=>!unique.includes(id));
 layer.elementIds=unique;
 return{...structuredClone(project),workbench:state};
}
export function updateDesignLayer(project:Project,layerId:string,patch:{name?:string;visible?:boolean;locked?:boolean},role:Role):Project{
 const state=layerState(project,role),layer=state.layers.find(layer=>layer.id===layerId);if(!layer)throw new Error('The layer no longer exists.');
 const next=structuredClone(project);
 if(patch.name!==undefined){const name=patch.name.trim();if(!name||name.length>120)throw new Error('Enter a layer name of 1–120 characters.');layer.name=name;}
 if(patch.visible!==undefined)layer.visible=patch.visible;
 if(patch.locked!==undefined&&patch.locked!==layer.locked){
  if(layer.kind==='design'){
   if(patch.locked){layer.managedLockIds=layer.elementIds.filter(id=>!next.constraints.lockedElementIds.includes(id));next.constraints.lockedElementIds=[...new Set([...next.constraints.lockedElementIds,...layer.elementIds])];}
   else{const owned=new Set(layer.managedLockIds??[]);next.constraints.lockedElementIds=next.constraints.lockedElementIds.filter(id=>!owned.has(id));layer.managedLockIds=[];}
  }
  layer.locked=patch.locked;
 }
 next.workbench=state;return next;
}
export function resolveLayerVisibility(project:Project):{hiddenIds:string[];contextHiddenIds:string[]}{
 const layers=project.workbench?.layers??[];
 return{hiddenIds:[...new Set(layers.filter(layer=>layer.kind==='design'&&!layer.visible).flatMap(layer=>layer.elementIds))],contextHiddenIds:[...new Set(layers.filter(layer=>layer.kind==='context'&&!layer.visible).flatMap(layer=>layer.elementIds))]};
}
export function layerSelection(project:Project,layerId:string):string[]{const layer=project.workbench?.layers.find(layer=>layer.id===layerId);return layer?.kind==='design'?layer.elementIds.filter(id=>project.elements.some(element=>element.id===id)):[];}
/** Shared reference assets stay outside BIM quantities, but a persistent layer can protect their placement/data. */
export function assertWorkbenchLayerLocks(project:Project,candidate:Project):void{
 for(const layer of project.workbench?.layers.filter(layer=>layer.locked)??[]){
  for(const id of layer.elementIds){const old=layer.kind==='context'?(id===terrainContextId?project.site?.terrain:project.site?.contexts.find(asset=>asset.id===id)):project.elements.find(element=>element.id===id),next=layer.kind==='context'?(id===terrainContextId?candidate.site?.terrain:candidate.site?.contexts.find(asset=>asset.id===id)):candidate.elements.find(element=>element.id===id);if(!equal(old,next))throw new Error(`${layer.kind==='context'?'Context':'Design'} layer ${layer.name} is locked. Unlock it before replacing, moving or removing its members.`);}
 }
}
/** Exact pre-review baseline guard; undo/audit are applied once by the workspace transaction. */
export function acceptDesignWorkbenchChange(project:Project,baseline:Project,candidate:Project,role:Role):Project{
 author(project,role);if(!equal(project,baseline))throw new Error('The project changed after this workbench preview. Review it again.');
 if(candidate.id!==project.id||!equal(candidate.audit,project.audit)||candidate.version!==project.version)throw new Error('A workbench operation cannot replace project identity, audit or revision state.');
 assertDesignSwitchUnlocked(project,candidate);
 assertWorkbenchLayerLocks(project,candidate);
 if(!projectSchema.safeParse(candidate).success)throw new Error('The workbench revision is invalid.');
 return structuredClone(candidate);
}
