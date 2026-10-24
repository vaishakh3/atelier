import type { Project, AiProposal, BimElement, ElementChange } from './types';
import { uid } from './seed';
import { footprint,worldToLocal } from '../model/geometry';
import {previewRepetition} from './repetition';
import {previewLayout} from './layout';
import {previewLocalRoomEdit} from './localRoomEdit';
import {elementSchema,levelSchema,projectSchema,layoutProposalSchema,localRoomEditProposalSchema} from './schema';

export function auditProject(project:Project,action:string,affectedIds:string[]=[],actor='You'):Project {
  return {...project,version:project.version+1,updatedAt:new Date().toISOString(),audit:[{id:uid('audit'),action,affectedIds,actor,timestamp:new Date().toISOString()},...project.audit].slice(0,250)};
}

const editableFields=new Set(['name','material','typeId','width','depth','height','x','y','z','rotation','properties']);
const numericFields=new Set(['width','depth','height','x','y','z','rotation']);
const geometryFields=new Set(['width','depth','height','x','y','z','rotation']);
const writableProperties=new Set(['classification','status','specification','fireRating']);
const proposalFields=new Set(['id','prompt','summary','kind','changes','issues','selectedIds','model','createdAt','crewCount','repetition','layout','creations','levelCreations','removals','roomResize','localEdit']);
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
/** Full reviewed snapshots retain every own field, including optional-field presence. */
function sameSnapshot(a:unknown,b:unknown):boolean {
  if(Object.is(a,b))return true;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>sameSnapshot(value,b[index]));
  if(!plain(a)||!plain(b))return false;
  const keys=Object.keys(a),other=Object.keys(b);
  return keys.length===other.length&&keys.every(key=>own(b,key)&&sameSnapshot(a[key],b[key]));
}
function layoutScopeLocked(project:Project,id:string,fields:string[],scope:'elements'|'levels'):boolean {
  const locks=project.constraints.lockedProperties;
  return project.constraints.lockedElementIds.includes(id)||locks.some(lock=>lock==='*'||lock===scope||lock===`${scope}.*`||lock===`model.${scope}`||lock===`model.${scope}.*`||lock===`${id}.*`||lock===`${scope}.${id}`||lock===`${scope}.${id}.*`||lock===`model.${scope}.${id}`||lock===`model.${scope}.${id}.*`||fields.some(field=>lock===field||lock===`model.${field}`||lock===`${id}.${field}`||lock===`${scope}.${field}`||lock===`${scope}.${id}.${field}`||lock===`${scope}.*.${field}`||scope==='levels'&&lock===`level.${id}.${field}`||lock===`model.${scope}.${field}`||lock===`model.${scope}.*.${field}`||lock===`model.${scope}.${id}.${field}`));
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
/** Positive physical overlap only: touching faces and semantic room volumes are allowed. */
function constructionOverlaps(a:BimElement,b:BimElement):boolean {
  const tolerance=1e-5;
  if(Math.min(a.z+a.height,b.z+b.height)-Math.max(a.z,b.z)<=tolerance)return false;
  const first=footprint(a),second=footprint(b);
  for(const polygon of [first,second])for(let index=0;index<polygon.length;index++){
    const point=polygon[index],next=polygon[(index+1)%polygon.length],length=Math.hypot(next.x-point.x,next.y-point.y),axis={x:-(next.y-point.y)/length,y:(next.x-point.x)/length};
    const left=first.map(p=>p.x*axis.x+p.y*axis.y),right=second.map(p=>p.x*axis.x+p.y*axis.y);
    if(Math.min(Math.max(...left),Math.max(...right))-Math.max(Math.min(...left),Math.min(...right))<=tolerance)return false;
  }
  return true;
}

/** Validate the entire proposal before producing a detached, undoable project revision. */
export function applyProposal(project:Project,proposal:AiProposal):Project {
  if(!plain(proposal)||Object.keys(proposal).some(key=>!proposalFields.has(key)))throw new Error('The proposal shape is invalid.');
  const metadataLimits={id:160,prompt:4000,summary:1500,model:121,createdAt:100};
  for(const key of ['id','prompt','summary','model','createdAt']as const)if(typeof proposal[key]!=='string'||proposal[key].length>metadataLimits[key])throw new Error('The proposal metadata is invalid.');
  if(!['edit','analysis','schedule','repetition','layout'].includes(proposal.kind)||!Array.isArray(proposal.changes)||proposal.changes.length>1000||!Array.isArray(proposal.selectedIds)||proposal.selectedIds.length>10000||proposal.selectedIds.some(id=>typeof id!=='string')||!Array.isArray(proposal.issues)||proposal.issues.length>500||proposal.issues.some(issue=>typeof issue!=='string'))throw new Error('The proposal shape is invalid.');
  if(own(proposal,'roomResize')){
    const resize=proposal.roomResize;
    if(!(proposal.kind==='layout'||proposal.kind==='edit'&&proposal.localEdit?.action==='resize-room')||!plain(resize)||Object.keys(resize).length!==4||Object.keys(resize).some(key=>!['roomKey','roomName','sourceArea','targetArea'].includes(key))||typeof resize.roomKey!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(resize.roomKey)||typeof resize.roomName!=='string'||!resize.roomName.trim()||resize.roomName.length>3000||[resize.sourceArea,resize.targetArea].some(area=>typeof area!=='number'||!Number.isFinite(area)||area<=0||area>1e6))throw new Error('The room resize context is invalid.');
  }
  if(own(proposal,'localEdit')){
    if(proposal.kind!=='edit'||own(proposal,'layout')||own(proposal,'levelCreations')||own(proposal,'crewCount')||own(proposal,'repetition'))throw new Error('A local room edit must be reviewed separately from house layouts and other operations.');
    const parsed=localRoomEditProposalSchema.safeParse(proposal.localEdit);
    if(!parsed.success||parsed.data.idPrefix!==proposal.id)throw new Error('The local room edit specification is invalid.');
    const spec=parsed.data;
    if(spec.baselineVersion!==project.version)throw new Error('The project changed after this local edit preview. Generate a new proposal.');
    const sourceIds=spec.action==='resize-room'?[spec.roomId]:spec.roomIds;
    if(new Set(sourceIds).size!==sourceIds.length||proposal.selectedIds.length!==sourceIds.length||sourceIds.some(id=>!proposal.selectedIds.includes(id)))throw new Error('The local edit must name exactly its reviewed source rooms.');
    if(proposal.roomResize){
      const room=spec.action==='resize-room'?project.elements.find(element=>element.id===spec.roomId):undefined;
      if(!room||String(room.properties.layoutKey)!==proposal.roomResize.roomKey||spec.action!=='resize-room'||Math.abs(spec.targetArea-proposal.roomResize.targetArea)>1e-6)throw new Error('The room resize context does not match the local edit.');
    }
    const derived=previewLocalRoomEdit(project,spec);
    if(derived.issues.length)throw new Error(derived.issues.join(' '));
    if(!derived.changes.length&&!derived.creations.length&&!derived.removals.length)throw new Error('The local edit contains no model changes.');
    const creations=proposal.creations??[],removals=proposal.removals??[];
    if(!Array.isArray(creations)||!Array.isArray(removals)||!sameSnapshot(proposal.changes,derived.changes)||!sameSnapshot(creations,derived.creations)||!sameSnapshot(removals,derived.removals))throw new Error('The local edit diff was changed, is incomplete, or is stale. Generate a new proposal.');
    const changed=new Map<string,BimElement>(),removed=new Set<string>(),created=new Set<string>(),existing=new Set(project.elements.map(element=>element.id));
    const guardSource=(id:string,before:unknown,after?:BimElement)=>{
      const current=project.elements.find(element=>element.id===id);
      if(!current||!sameSnapshot(current,before)||!current.editable||current.externalId!==undefined||current.kind==='reference')throw new Error('A local edit source changed or is not editable native geometry.');
      const fields=after?Object.keys(current).filter(key=>!sameSnapshot(current[key as keyof BimElement],after[key as keyof BimElement])):Object.keys(current);
      if(fields.includes('properties'))for(const key of new Set([...Object.keys(current.properties),...Object.keys(after?.properties??{})]))if(!after||!sameSnapshot(current.properties[key],after.properties[key]))fields.push(`properties.${key}`,key);
      if(fields.some(field=>geometryFields.has(field)||field==='footprint'))fields.push('geometry','geometry.*','position','position.*','dimensions','dimensions.*');
      if(layoutScopeLocked(project,id,fields,'elements'))throw new Error('An affected local element or property is locked.');
    };
    for(const change of derived.changes){
      const after=change.after as BimElement;guardSource(change.elementId,change.before,after);
      if(after.id!==change.elementId||changed.has(after.id)||!elementSchema.safeParse(after).success)throw new Error('The local edit has invalid or duplicate changed geometry.');
      validateGeometry(after);validateProperties(after.properties);changed.set(after.id,after);
    }
    for(const removal of derived.removals){guardSource(removal.elementId,removal.before);if(removed.has(removal.elementId)||changed.has(removal.elementId))throw new Error('The local removal scope is duplicated.');removed.add(removal.elementId);}
    for(const creation of derived.creations){
      const after=creation.after;
      if(after.id!==creation.elementId||existing.has(after.id)||created.has(after.id)||!elementSchema.safeParse(after).success)throw new Error('The local edit has an invalid or duplicate new element.');
      if(layoutScopeLocked(project,after.id,[...Object.keys(after),'geometry','geometry.*','position','position.*','dimensions','dimensions.*'],'elements'))throw new Error('The required local geometry is locked.');
      validateGeometry(after);validateProperties(after.properties);created.add(after.id);
    }
    const affected=[...changed.values(),...derived.creations.map(item=>item.after)];
    for(const after of affected){const type=project.types.filter(item=>item.id===after.typeId);if(type.length!==1||!type[0].approved||type[0].kind!==after.kind||type[0].material!==after.material)throw new Error('A local edit requires approved compatible component types.');}
    const next=structuredClone(project);next.elements=project.elements.filter(element=>!removed.has(element.id)).map(element=>structuredClone(changed.get(element.id)??element));next.elements.push(...structuredClone(derived.creations.map(item=>item.after)));
    if(!projectSchema.safeParse(next).success)throw new Error('The complete local edit does not satisfy the project schema.');
    for(const element of next.elements)if(element.hostId&&removed.has(element.hostId))throw new Error('The local edit would orphan a retained hosted opening.');
    for(const element of affected)validateOpening(element,next);
    // This transaction does not refresh or approve construction activities or services.
    return auditProject(next,`AI: ${proposal.summary}`,[...changed.keys(),...removed,...created],'You · AI assisted');
  }
  if(proposal.kind==='layout'){
    if(proposal.changes.length||own(proposal,'crewCount')||own(proposal,'repetition'))throw new Error('Create a layout separately from model edits, repetition and crew changes.');
    const parsed=layoutProposalSchema.safeParse(proposal.layout);
    if(!parsed.success||parsed.data.idPrefix!==proposal.id)throw new Error('The layout specification is invalid.');
    const layout=parsed.data;
    if(proposal.roomResize&&!layout.rooms.some(room=>room.key===proposal.roomResize!.roomKey&&room.area!==null&&Math.abs(room.area-proposal.roomResize!.targetArea)<1e-6))throw new Error('The room resize context does not match the reviewed layout.');
    if(layout.baselineVersion!==project.version)throw new Error('The project changed after this layout preview. Generate a new proposal.');
    if(layout.footprintId?proposal.selectedIds.length!==1||proposal.selectedIds[0]!==layout.footprintId:proposal.selectedIds.length!==0)throw new Error('A layout requires an empty selection or exactly its selected slab footprint.');
    const selectedSlab=project.elements.find(element=>element.id===layout.footprintId);
    if(layout.replaceConcept===true&&selectedSlab?.properties.conceptLayout===true&&(selectedSlab.properties.floorIndex===1||typeof selectedSlab.properties.layoutBaseLevelId==='string'&&selectedSlab.properties.layoutBaseLevelId!==selectedSlab.levelId))throw new Error('The selected upper-floor concept slab is a stair-opening piece. Clear the selection to replan the whole house from its base, or select its ground-floor slab.');
    if(!Array.isArray(proposal.creations)||proposal.creations.length<1||proposal.creations.length>200)throw new Error('The layout creation review is invalid.');
    const derived=previewLayout(project,layout);
    if(derived.issues.length||!derived.elements.length)throw new Error(derived.issues.join(' ')||'The layout cannot be created within this footprint.');
    const newLevels=derived.levels,removed=derived.removedElements;
    const levelDiffs=proposal.levelCreations??[],removalDiffs=proposal.removals??[];
    if(!Array.isArray(levelDiffs)||levelDiffs.length>1||!Array.isArray(removalDiffs)||removalDiffs.length>200)throw new Error('The layout level or removal review is invalid.');
    if(proposal.creations.length!==derived.elements.length||levelDiffs.length!==newLevels.length||removalDiffs.length!==removed.length)throw new Error('The layout element, level or removal review is incomplete.');
    if(removed.length&&layout.replaceConcept!==true)throw new Error('Removing a previous concept requires an explicit replacement proposal.');
    const reviewed=new Map<string,unknown>();
    for(const creation of proposal.creations){
      if(!plain(creation)||Object.keys(creation).length!==3||Object.keys(creation).some(key=>!['elementId','before','after'].includes(key))||typeof creation.elementId!=='string'||reviewed.has(creation.elementId)||creation.before!==null||!plain(creation.after)||!elementSchema.safeParse(creation.after).success)throw new Error('The layout contains an invalid or duplicate creation.');
      reviewed.set(creation.elementId,creation.after);
    }
    const existingIds=new Set(project.elements.map(element=>element.id)),createdIds=new Set<string>();
    for(const element of derived.elements){
      if(!sameSnapshot(reviewed.get(element.id),element))throw new Error('The layout creation diff was changed or is stale. Generate a new proposal.');
      if(existingIds.has(element.id)||createdIds.has(element.id))throw new Error('A layout element ID already exists or is duplicated.');
      createdIds.add(element.id);
      if(!elementSchema.safeParse(element).success)throw new Error('A layout element exceeds the supported model schema.');
      const type=project.types.filter(type=>type.id===element.typeId);
      if(type.length!==1||!type[0].approved||type[0].kind!==element.kind||type[0].material!==element.material)throw new Error('A layout element needs one approved compatible component type.');
      if(layoutScopeLocked(project,element.id,['geometry','geometry.*','position','position.*','dimensions','dimensions.*','x','y','z','width','depth','height','rotation','hostId','levelId'],'elements'))throw new Error('The required layout geometry is locked.');
      validateGeometry(element);validateProperties(element.properties);
    }
    const reviewedLevels=new Map<string,unknown>(),existingLevels=new Set(project.levels.map(level=>level.id));
    for(const creation of levelDiffs){
      if(!plain(creation)||Object.keys(creation).length!==3||Object.keys(creation).some(key=>!['levelId','before','after'].includes(key))||typeof creation.levelId!=='string'||reviewedLevels.has(creation.levelId)||creation.before!==null||!plain(creation.after)||!levelSchema.safeParse(creation.after).success)throw new Error('The layout contains an invalid or duplicate level creation.');
      reviewedLevels.set(creation.levelId,creation.after);
    }
    for(const level of newLevels){
      if(!sameSnapshot(reviewedLevels.get(level.id),level)||existingLevels.has(level.id))throw new Error('The layout level diff was changed, duplicated or is stale.');
      if(!levelSchema.safeParse(level).success||Math.abs(level.elevation)>1e7)throw new Error('The proposed building level is outside the supported range.');
      if(layoutScopeLocked(project,level.id,['id','name','elevation'],'levels'))throw new Error('The required building level is locked.');
      existingLevels.add(level.id);
    }
    const sourceAnchors=layout.footprintId?project.elements.filter(element=>element.id===layout.footprintId):project.elements.filter(element=>element.kind==='slab'&&element.levelId===derived.footprint.levelId&&element.properties.conceptLayout===true);
    const removalAnchor=sourceAnchors.length===1?sourceAnchors[0]:undefined,removalLevels=new Set(derived.floors.map(floor=>floor.level.id));
    if(removed.length&&!removalAnchor)throw new Error('The concept replacement has no unambiguous original footprint to bound removals.');
    const reviewedRemovals=new Map<string,unknown>(),removedIds=new Set<string>();
    for(const removal of removalDiffs){
      if(!plain(removal)||Object.keys(removal).length!==3||Object.keys(removal).some(key=>!['elementId','before','after'].includes(key))||typeof removal.elementId!=='string'||reviewedRemovals.has(removal.elementId)||removal.after!==null||!plain(removal.before)||!elementSchema.safeParse(removal.before).success)throw new Error('The layout contains an invalid or duplicate removal.');
      reviewedRemovals.set(removal.elementId,removal.before);
    }
    for(const element of removed){
      const current=project.elements.find(candidate=>candidate.id===element.id);
      if(!current||!sameSnapshot(current,element)||!sameSnapshot(reviewedRemovals.get(element.id),element))throw new Error('A concept removal diff was changed or is stale. Generate a new proposal.');
      if(element.id===layout.footprintId||!element.editable||element.kind==='reference'||element.externalId!==undefined||element.properties.conceptLayout!==true)throw new Error('Only editable native concept-generated geometry may be replaced; the selected slab is retained.');
      if(!removalLevels.has(element.levelId)||!removalAnchor||!footprint(element).every(point=>{const local=worldToLocal(removalAnchor,point);return local.x>=-1e-5&&local.y>=-1e-5&&local.x<=removalAnchor.width+1e-5&&local.y<=removalAnchor.depth+1e-5;}))throw new Error('A concept removal is outside the original house footprint or reviewed storeys. Unrelated geometry is retained.');
      if(removedIds.has(element.id))throw new Error('The layout includes a duplicate removal.');
      const fields=[...Object.keys(element),...Object.keys(element.properties).flatMap(key=>[key,`properties.${key}`]),'geometry','geometry.*','position','position.*','dimensions','dimensions.*','properties.*'];
      if(layoutScopeLocked(project,element.id,fields,'elements'))throw new Error('A concept element or specification scheduled for replacement is locked.');
      removedIds.add(element.id);
    }
    if(project.elements.length-removedIds.size+derived.elements.length>10000||project.levels.length+newLevels.length>100)throw new Error('This layout exceeds the supported project element or level limit.');
    const retained=project.elements.filter(element=>!removedIds.has(element.id));
    if(retained.some(element=>element.hostId&&removedIds.has(element.hostId)))throw new Error('Replacing this concept would orphan a retained or manual hosted element.');
    const foreignPhysical=retained.filter(element=>!removalLevels.has(element.levelId)&&element.kind!=='room');
    for(const element of derived.elements.filter(element=>['wall','slab','stair','roof'].includes(element.kind)))if(foreignPhysical.some(existing=>constructionOverlaps(element,existing)))throw new Error('The proposed construction overlaps retained physical geometry on another building level. Review the intersecting levels first.');
    const next=structuredClone(project);next.levels.push(...structuredClone(newLevels));next.elements=[...structuredClone(retained),...structuredClone(derived.elements)];
    if(!projectSchema.safeParse(next).success)throw new Error('The complete layout revision does not satisfy the project schema.');
    for(const element of derived.elements){if(!existingLevels.has(element.levelId))throw new Error('A layout element references an unknown building level.');validateOpening(element,next);}
    return auditProject(next,`AI: ${proposal.summary}`,[...derived.elements.map(element=>element.id),...removedIds,...newLevels.map(level=>level.id)],'You · AI assisted');
  }
  if(own(proposal,'layout')||own(proposal,'levelCreations')||own(proposal,'removals'))throw new Error('A layout cannot be mixed with another proposal kind.');
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
