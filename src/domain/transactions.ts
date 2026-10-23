import type { Project, AiProposal, BimElement, ElementChange } from './types';
import { uid } from './seed';
import { worldToLocal } from '../model/geometry';
import {previewRepetition} from './repetition';
import {previewLayout} from './layout';
import {elementSchema,layoutProposalSchema} from './schema';

export function auditProject(project:Project,action:string,affectedIds:string[]=[],actor='You'):Project {
  return {...project,version:project.version+1,updatedAt:new Date().toISOString(),audit:[{id:uid('audit'),action,affectedIds,actor,timestamp:new Date().toISOString()},...project.audit].slice(0,250)};
}

const editableFields=new Set(['name','material','typeId','width','depth','height','x','y','z','rotation','properties']);
const numericFields=new Set(['width','depth','height','x','y','z','rotation']);
const geometryFields=new Set(['width','depth','height','x','y','z','rotation']);
const writableProperties=new Set(['classification','status','specification','fireRating']);
const proposalFields=new Set(['id','prompt','summary','kind','changes','issues','selectedIds','model','createdAt','crewCount','repetition','layout','creations']);
const unsafeKeys=new Set(['__proto__','prototype','constructor']);
const own=(object:object,key:string)=>Object.prototype.hasOwnProperty.call(object,key);
function plain(value:unknown):value is Record<string,unknown> {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
}
function same(a:unknown,b:unknown):boolean {
  if(Object.is(a,b))return true;
  if(!plain(a)||!plain(b))return false;
  const keys=Object.keys(a).filter(key=>a[key]!==undefined),other=Object.keys(b).filter(key=>b[key]!==undefined);
  return keys.length===other.length&&keys.every(key=>own(b,key)&&same(a[key],b[key]));
}
function locked(project:Project,field:string):boolean {
  const fields=project.constraints.lockedProperties;
  return fields.includes('*')||fields.includes(field)||(field.startsWith('properties.')&&(fields.includes('properties')||fields.includes('properties.*')||fields.includes(field.slice(11))));
}
function validateProperties(value:unknown):asserts value is BimElement['properties'] {
  if(!plain(value)||Object.keys(value).length>200)throw new Error('The proposal contains an invalid property record.');
  for(const [key,v]of Object.entries(value)) {
    if(unsafeKeys.has(key)||!key||key.length>100||!(typeof v==='boolean'||typeof v==='string'&&v.length<=3000||typeof v==='number'&&Number.isFinite(v)))throw new Error('The proposal contains an invalid property value.');
  }
}
function validatePatch(patch:unknown):asserts patch is Partial<BimElement> {
  if(!plain(patch)||Object.keys(patch).length===0)throw new Error('A model revision must contain explicit before and after values.');
  for(const [key,value]of Object.entries(patch)) {
    if(!editableFields.has(key))throw new Error(`AI cannot modify the ${key} field.`);
    if(numericFields.has(key)) {
      if(typeof value!=='number'||!Number.isFinite(value))throw new Error('The proposed geometry must contain finite numbers.');
    }else if(key==='properties')validateProperties(value);
    else if(typeof value!=='string'||value.length>3000||key==='name'&&!value.trim())throw new Error('The proposed identity or material is invalid.');
  }
}
function validateGeometry(element:BimElement) {
  if(['width','depth','height'].some(key=>{const v=element[key as 'width'|'depth'|'height'];return !Number.isFinite(v)||v<.005||v>1000;})||['x','y','z'].some(key=>{const v=element[key as 'x'|'y'|'z'];return !Number.isFinite(v)||Math.abs(v)>1e7;})||!Number.isFinite(element.rotation)||Math.abs(element.rotation)>36000)throw new Error('The proposed dimensions or position are outside the supported building range.');
}
function validateOpening(element:BimElement,project:Project) {
  if(element.kind!=='door'&&element.kind!=='window')return;
  const host=project.elements.find(e=>e.id===element.hostId);
  if(!host||host.kind!=='wall'||host.levelId!==element.levelId)throw new Error('The opening needs a valid wall host on the same building level.');
  const point=worldToLocal(host,element),rotation=((element.rotation-host.rotation)%360+540)%360-180;
  const tolerance=1e-5;
  if(point.x< -tolerance||point.x+element.width>host.width+tolerance||element.z<host.z-tolerance||element.z+element.height>host.z+host.height+tolerance||Math.abs(rotation)>.1||point.y< -Math.max(.15,host.depth)||point.y>host.depth+.15||element.depth>Math.max(.6,host.depth*3))throw new Error('The proposed opening does not fit inside its wall host. Review its position, rotation and dimensions.');
}

/** Validate the entire proposal before producing a detached, undoable project revision. */
export function applyProposal(project:Project,proposal:AiProposal):Project {
  if(!plain(proposal)||Object.keys(proposal).some(key=>!proposalFields.has(key)))throw new Error('The proposal shape is invalid.');
  const metadataLimits={id:160,prompt:4000,summary:1500,model:121,createdAt:100};
  for(const key of ['id','prompt','summary','model','createdAt']as const)if(typeof proposal[key]!=='string'||proposal[key].length>metadataLimits[key])throw new Error('The proposal metadata is invalid.');
  if(!['edit','analysis','schedule','repetition','layout'].includes(proposal.kind)||!Array.isArray(proposal.changes)||proposal.changes.length>1000||!Array.isArray(proposal.selectedIds)||proposal.selectedIds.length>10000||proposal.selectedIds.some(id=>typeof id!=='string')||!Array.isArray(proposal.issues)||proposal.issues.length>500||proposal.issues.some(issue=>typeof issue!=='string'))throw new Error('The proposal shape is invalid.');
  if(proposal.kind==='layout'){
    if(proposal.changes.length||own(proposal,'crewCount')||own(proposal,'repetition'))throw new Error('Create a layout separately from model edits, repetition and crew changes.');
    const parsed=layoutProposalSchema.safeParse(proposal.layout);
    if(!parsed.success||parsed.data.idPrefix!==proposal.id)throw new Error('The layout specification is invalid.');
    const layout=parsed.data;
    if(layout.baselineVersion!==project.version)throw new Error('The project changed after this layout preview. Generate a new proposal.');
    if(layout.footprintId?proposal.selectedIds.length!==1||proposal.selectedIds[0]!==layout.footprintId:proposal.selectedIds.length!==0)throw new Error('A layout requires an empty selection or exactly its selected slab footprint.');
    if(!Array.isArray(proposal.creations)||proposal.creations.length<1||proposal.creations.length>200)throw new Error('The layout creation review is invalid.');
    const derived=previewLayout(project,layout);
    if(derived.issues.length||!derived.elements.length)throw new Error(derived.issues.join(' ')||'The layout cannot be created within this footprint.');
    if(proposal.creations.length!==derived.elements.length)throw new Error('The layout creation review is incomplete.');
    const reviewed=new Map<string,unknown>();
    for(const creation of proposal.creations){
      if(!plain(creation)||Object.keys(creation).some(key=>!['elementId','before','after'].includes(key))||typeof creation.elementId!=='string'||reviewed.has(creation.elementId)||creation.before!==null)throw new Error('The layout contains an invalid or duplicate creation.');
      reviewed.set(creation.elementId,creation.after);
    }
    for(const element of derived.elements){
      if(!same(reviewed.get(element.id),element))throw new Error('The layout creation diff was changed or is stale. Generate a new proposal.');
      if(!elementSchema.safeParse(element).success)throw new Error('A layout element exceeds the supported model schema.');
      validateGeometry(element);validateProperties(element.properties);
    }
    if(project.elements.length+derived.elements.length>10000)throw new Error('This layout exceeds the supported project element limit.');
    const next=structuredClone(project);next.elements.push(...structuredClone(derived.elements));
    for(const element of derived.elements)validateOpening(element,next);
    return auditProject(next,`AI: ${proposal.summary}`,derived.elements.map(element=>element.id),'You · AI assisted');
  }
  if(own(proposal,'layout'))throw new Error('A layout cannot be mixed with another proposal kind.');
  if(proposal.kind==='repetition'){
    if(proposal.changes.length||own(proposal,'crewCount'))throw new Error('Evaluate repetition separately from edits and crew changes.');
    const repetition=proposal.repetition;
    if(!plain(repetition)||Object.keys(repetition).some(key=>!['sourceIds','count','offsetX','offsetY','idPrefix','sources'].includes(key))||!Array.isArray(repetition.sourceIds)||!repetition.sourceIds.length||repetition.sourceIds.length>100||repetition.sourceIds.some(id=>typeof id!=='string'||!proposal.selectedIds.includes(id))||new Set(repetition.sourceIds).size!==repetition.sourceIds.length||repetition.idPrefix!==proposal.id||!Array.isArray(repetition.sources)||repetition.sources.length>100||repetition.sources.some(source=>!elementSchema.safeParse(source).success)||!Array.isArray(proposal.creations)||proposal.creations.length>100||proposal.creations.some(creation=>!plain(creation)||typeof creation.elementId!=='string'))throw new Error('The repeated modelling scope or preview is invalid.');
    const derived=previewRepetition(project,repetition);
    if(derived.issues.length||!derived.elements.length)throw new Error(derived.issues.join(' ')||'The repeated geometry cannot be created.');
    if(derived.sourceIds.length!==repetition.sources.length||new Set(repetition.sources.map(source=>source.id)).size!==repetition.sources.length||derived.sourceIds.some(id=>!repetition.sources.some(source=>source.id===id&&same(source,project.elements.find(element=>element.id===id)))))throw new Error('A repetition source or hosted opening changed after this preview. Generate a new proposal.');
    if(proposal.creations.length!==derived.elements.length)throw new Error('The created-element review does not match the repeated operation.');
    for(const element of derived.elements){const creation=proposal.creations.find(item=>item.elementId===element.id);if(!plain(creation)||Object.keys(creation).some(key=>!['elementId','before','after'].includes(key))||creation.before!==null||!same(creation.after,element))throw new Error('The repeated creation diff was changed or is incomplete.');if(!elementSchema.safeParse(element).success)throw new Error('A repeated element exceeds the supported model schema.');validateGeometry(element);validateProperties(element.properties);}
    if(project.elements.length+derived.elements.length>10000)throw new Error('This repetition exceeds the supported project element limit.');
    const next=structuredClone(project);next.elements.push(...derived.elements);for(const element of derived.elements)validateOpening(element,next);
    return auditProject(next,`AI: ${proposal.summary}`,derived.elements.map(element=>element.id),'You · AI assisted');
  }
  if(own(proposal,'repetition')||own(proposal,'creations'))throw new Error('A repetition cannot be mixed with another proposal kind.');
  if(proposal.kind==='analysis') {
    if(proposal.changes.length||own(proposal,'crewCount'))throw new Error('An analysis response cannot change the project.');
    return structuredClone(project);
  }
  if(proposal.kind==='schedule') {
    if(proposal.changes.length)throw new Error('Evaluate schedule changes separately from model edits.');
    if(!Number.isInteger(proposal.crewCount)||proposal.crewCount!<1||proposal.crewCount!>Math.min(1000,project.constraints.maxCrews))throw new Error('The proposed crew count exceeds the permitted project capacity.');
    if(locked(project,'schedule')||locked(project,'schedule.crews')||locked(project,'crews'))throw new Error('The crew capacity is locked.');
    const next=structuredClone(project);next.schedule.crews=proposal.crewCount!;
    return auditProject(next,`AI: ${proposal.summary}`,[],'You · AI assisted');
  }
  if(own(proposal,'crewCount')||!proposal.changes.length)throw new Error('A model revision must contain edits and cannot also change crew capacity.');
  const selected=new Set(proposal.selectedIds),elementLocks=new Set(project.constraints.lockedElementIds),seen=new Set<string>();
  const validated:ElementChange[]=[];
  for(const change of proposal.changes) {
    if(!plain(change)||Object.keys(change).some(key=>!['elementId','before','after'].includes(key))||typeof change.elementId!=='string'||seen.has(change.elementId))throw new Error('The revision contains an invalid or duplicate element change.');
    seen.add(change.elementId);
    const element=project.elements.find(e=>e.id===change.elementId);
    if(!element||!element.editable||element.kind==='reference'||elementLocks.has(element.id)||!selected.has(element.id))throw new Error('The proposal includes an unavailable, locked, or unselected element.');
    validatePatch(change.before);validatePatch(change.after);
    const beforeKeys=Object.keys(change.before),afterKeys=Object.keys(change.after);
    if(beforeKeys.length!==afterKeys.length||afterKeys.some(key=>!own(change.before,key)))throw new Error('Every proposed field must include its original value for review.');
    for(const key of afterKeys as(keyof BimElement)[]) {
      if(!same(element[key],change.before[key]))throw new Error('The model changed after this preview. Generate a new proposal.');
      if(same(element[key],change.after[key]))continue;
      if(locked(project,key))throw new Error(`The ${key} property is locked.`);
      if(key==='properties') {
        const previous=element.properties,next=change.after.properties!;
        for(const nestedKey of new Set([...Object.keys(previous),...Object.keys(next)])) {
          if(same(previous[nestedKey],next[nestedKey]))continue;
          if(!writableProperties.has(nestedKey))throw new Error(`AI cannot modify the ${nestedKey} specification in this release.`);
          if(!own(next,nestedKey))throw new Error('AI cannot delete specification properties.');
          if(locked(project,`properties.${nestedKey}`))throw new Error(`The ${nestedKey} specification is locked.`);
        }
      }
    }
    const next={...element,...change.after};validateGeometry(next);
    if(next.typeId!==element.typeId) {
      const type=project.types.find(t=>t.id===next.typeId);
      if(!type||!type.approved||type.kind!==element.kind)throw new Error('A replacement type must be approved and match the element class.');
      if(next.material!==type.material)throw new Error('A type replacement must include the matching material specification.');
      if(locked(project,'material'))throw new Error('The material property is locked.');
    }
    if(element.kind==='wall'&&project.elements.some(e=>e.hostId===element.id)&&afterKeys.some(key=>geometryFields.has(key)&&!same(element[key as keyof BimElement],next[key as keyof BimElement])))throw new Error('AI geometry changes to a wall with hosted openings require manual coordination. Use the modelling tools to keep its openings coordinated.');
    validateOpening(next,project);
    validated.push(change);
  }
  const next=structuredClone(project);
  next.elements=next.elements.map(element=>{
    const change=validated.find(c=>c.elementId===element.id);
    return change?{...element,...structuredClone(change.after)}:element;
  });
  return auditProject(next,`AI: ${proposal.summary}`,validated.map(c=>c.elementId),'You · AI assisted');
}
