import {afterEach,describe,it,expect,vi} from 'vitest';
import {APIConnectionTimeoutError} from 'openai/error';
import {zodTextFormat} from 'openai/helpers/zod';
const provider=vi.hoisted(()=>({status:401,calls:0,response:null as unknown,options:null as unknown,error:null as unknown,requests:[] as Record<string,unknown>[] }));
vi.mock('openai',()=>({default:class {constructor(options:unknown){provider.options=options;}responses={parse:async(request:Record<string,unknown>)=>{provider.calls++;provider.requests.push(request);if(provider.error)throw provider.error;if(provider.response)return provider.response;throw{status:provider.status,message:'Sensitive provider diagnostic: synthetic-credential-do-not-echo'};}};}}));
import {requestProposal,buildProposal,AI_REQUEST_TIMEOUT_MS,AI_MAX_OUTPUT_TOKENS} from '../server/copilot';
import {DEFAULT_AI_MODEL,resolveAiModel,aiModelLabel} from '../src/domain/aiConfig';
import {createDemoProject,createBlankProject} from '../src/domain/seed';
import {aiOutputSchema,layoutRoomSchema} from '../src/domain/schema';
import {applyProposal} from '../src/domain/transactions';
import type {BimElement,LayoutSpec} from '../src/domain/types';
afterEach(()=>{vi.unstubAllEnvs();provider.calls=0;provider.response=null;provider.options=null;provider.error=null;provider.requests=[];});
const input=()=>({prompt:'Explain project',selectedIds:[],project:createDemoProject()});
describe('provider failures remain distinct from local account authentication',()=>{
 it('maps upstream401 to502 without exposing credentials or expiring the local identity',async()=>{vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');provider.status=401;const context=input(),before=structuredClone(context.project);let caught:unknown;try{await requestProposal(context);}catch(error){caught=error;}expect(caught).toMatchObject({status:502,code:'AI_PROVIDER_AUTH'});expect(String(caught)).not.toContain('synthetic-credential-do-not-echo');expect(context.project).toEqual(before);expect(provider.calls).toBe(1);});
 it('preserves quota429 as a provider-specific failure',async()=>{vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');provider.status=429;await expect(requestProposal(input())).rejects.toMatchObject({status:429,code:'AI_RATE_LIMIT'});});
 it('reports missing configuration without making any provider request',async()=>{vi.stubEnv('OPENAI_API_KEY','');await expect(requestProposal(input())).rejects.toMatchObject({status:503,code:'AI_NOT_CONFIGURED'});expect(provider.calls).toBe(0);});
});

describe('GPT-6.1 Sol request compatibility and upgrade',()=>{
 it('sends the exact supported model, reasoning and structured-output contract with a bounded generation budget',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');vi.stubEnv('OPENAI_MODEL','');provider.response={status:'completed',output_parsed:{summary:'No model changes requested',operations:[],issues:[]}};const context={...input(),activeLevelId:'level-0'},before=structuredClone(context.project),proposal=await requestProposal(context),request=provider.requests[0];
  expect(request).toMatchObject({model:DEFAULT_AI_MODEL,store:false,reasoning:{effort:'medium'},max_output_tokens:AI_MAX_OUTPUT_TOKENS});expect(AI_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(12000);expect(provider.options).toMatchObject({timeout:AI_REQUEST_TIMEOUT_MS,maxRetries:0});expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(120000);
  expect(request).not.toHaveProperty('temperature');expect(request).not.toHaveProperty('top_p');expect(request).not.toHaveProperty('max_tokens');expect(request).not.toHaveProperty('reasoning_effort');expect(request.text).toMatchObject({format:{type:'json_schema',name:'bim_proposal',strict:true}});
  const sent=JSON.parse(String(request.input));expect(sent.activeLevelId).toBe('level-0');expect(sent.project.levels).toEqual(context.project.levels);expect(sent.capabilities.createLayout).toMatchObject({supported:true,creationWithoutSelection:true});expect(String(request.instructions)).toContain('use create-layout');expect(String(request.instructions)).toContain('use null');expect(JSON.stringify(request)).not.toContain('synthetic-credential-do-not-echo');expect(proposal.model).toBe(DEFAULT_AI_MODEL);expect(context.project).toEqual(before);
 });
 it('upgrades the former default while preserving other deliberate model choices and historical labels',async()=>{
  expect(resolveAiModel()).toBe(DEFAULT_AI_MODEL);expect(resolveAiModel('gpt-4.1-mini')).toBe(DEFAULT_AI_MODEL);expect(aiModelLabel('gpt-4.1-mini')).toBe('gpt-4.1-mini');expect(aiModelLabel(DEFAULT_AI_MODEL)).toBe('GPT-6.1 Sol');
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');vi.stubEnv('OPENAI_MODEL','gpt-6-luna');provider.response={status:'completed',output_parsed:{summary:'Analysis',operations:[],issues:[]}};const proposal=await requestProposal(input());expect(provider.requests[0].model).toBe('gpt-6-luna');expect(provider.requests[0]).not.toHaveProperty('reasoning');expect(proposal.model).toBe('gpt-6-luna');
  vi.stubEnv('OPENAI_MODEL','gpt-4.1-mini');expect((await requestProposal(input())).model).toBe(DEFAULT_AI_MODEL);expect(provider.requests[1].model).toBe(DEFAULT_AI_MODEL);
 });
 it('reports model access failures clearly and never retries with another model',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');vi.stubEnv('OPENAI_MODEL','gpt-6.1-sol');provider.status=404;await expect(requestProposal(input())).rejects.toMatchObject({status:502,code:'AI_MODEL_ACCESS'});expect(provider.calls).toBe(1);expect(provider.requests[0].model).toBe(DEFAULT_AI_MODEL);
 });
 it('recognizes the installed SDK timeout class without disclosing provider diagnostics',async()=>{vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');provider.error=new APIConnectionTimeoutError({message:'A private diagnostic'});await expect(requestProposal(input())).rejects.toMatchObject({status:504,code:'AI_TIMEOUT'});expect(provider.calls).toBe(1);});
 it('rejects an unknown active level before sending project data and distinguishes incomplete output',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');await expect(requestProposal({...input(),activeLevelId:'unknown-level'})).rejects.toMatchObject({status:400,code:'AI_ACTIVE_LEVEL'});expect(provider.calls).toBe(0);
  provider.response={status:'incomplete',output_parsed:null};await expect(requestProposal(input())).rejects.toMatchObject({status:422,code:'AI_OUTPUT_LIMIT'});
 });
});

const houseProgram:LayoutSpec={levelId:'level-0',footprintId:null,width:null,depth:null,rooms:[
 {key:'bed-1',name:'Bedroom 1',use:'bedroom',area:null,attachedTo:null},
 {key:'bath-1',name:'Bedroom 1 attached bathroom',use:'bathroom',area:null,attachedTo:'bed-1'},
 {key:'bed-2',name:'Bedroom 2',use:'bedroom',area:null,attachedTo:null},
 {key:'bath-2',name:'Bedroom 2 attached bathroom',use:'bathroom',area:null,attachedTo:'bed-2'},
 {key:'common-bath',name:'Common bathroom',use:'bathroom',area:null,attachedTo:null},
 {key:'living',name:'Living room',use:'living',area:null,attachedTo:null},
 {key:'theater',name:'Home theater',use:'theater',area:null,attachedTo:null},
 {key:'pool',name:'Indoor swimming pool zone',use:'pool',area:null,attachedTo:null}
]};
const layoutOutput=(layout=houseProgram)=>aiOutputSchema.parse({summary:'Propose the requested house program',operations:[{action:'create-layout',layout}],issues:[]});
describe('provider room attachment contract',()=>{
 it('enforces literal null for every non-bathroom attachment in the actual strict SDK JSON schema',()=>{
  const format=zodTextFormat(aiOutputSchema,'bim_proposal'),schema=JSON.parse(JSON.stringify(format.schema));
  const layout=schema.properties.operations.items.anyOf.find((branch:any)=>branch.properties.action.const==='create-layout').properties.layout,branches=layout.properties.rooms.items.anyOf;
  const service=branches.find((branch:any)=>branch.properties.use.enum?.includes('utility')),bathroom=branches.find((branch:any)=>branch.properties.use.const==='bathroom');
  expect(format.strict).toBe(true);expect(schema.type).toBe('object');expect(schema.anyOf).toBeUndefined();expect(branches).toHaveLength(2);
  expect(service.properties.attachedTo).toEqual({type:'null'});expect(service.properties.use.enum).not.toContain('bathroom');expect(bathroom.properties.attachedTo.anyOf.map((branch:any)=>branch.type)).toEqual(['string','null']);
  // Check the converted format sent to OpenAI, not an unexported local Zod refinement.
  const inspect=(value:any)=>{if(!value||typeof value!=='object')return;if(value.type==='object'){expect(value.additionalProperties).toBe(false);expect([...value.required].sort()).toEqual(Object.keys(value.properties).sort());}expect(value.oneOf).toBeUndefined();for(const child of Object.values(value))if(Array.isArray(child))child.forEach(inspect);else inspect(child);};inspect(schema);
  const pantry={key:'pantry',name:'Pantry',use:'utility',area:null,attachedTo:null,floor:null};expect(layoutRoomSchema.parse(pantry)).toEqual(pantry);
  for(const use of service.properties.use.enum)expect(layoutRoomSchema.safeParse({...pantry,use,attachedTo:'kitchen'}).success).toBe(false);
  expect(layoutRoomSchema.safeParse({...pantry,use:'bathroom',attachedTo:'bedroom'}).success).toBe(true);
 });

 it('retains the requested pantry programme and derives kitchen access separately from ensuite attachment',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');
  const room=(key:string,use:LayoutSpec['rooms'][number]['use'],attachedTo:string|null=null):LayoutSpec['rooms'][number]=>({key,name:key==='pantry'?'Pantry':key,use,area:null,attachedTo,floor:null});
  const rooms=[room('living','living'),room('dining','dining'),room('kitchen','kitchen'),room('laundry','utility'),room('pantry','utility'),room('guest-wc','bathroom'),room('family-bath','bathroom'),...[1,2,3,4].map(index=>room(`bed${index}`,'bedroom')),room('ensuite','bathroom','bed1')],spec:LayoutSpec={...houseProgram,rooms,storeys:2};
  provider.response={status:'completed',output_parsed:layoutOutput(spec)};const project=createBlankProject('Pantry connection'),before=structuredClone(project),proposal=await requestProposal({project,selectedIds:[],prompt:'Make this two-storey house with a pantry attached directly to the kitchen.'});
  expect(proposal.layout!.rooms).toEqual(rooms);const created=proposal.creations!.map(creation=>creation.after),pantry=created.find(element=>element.kind==='room'&&element.properties.layoutKey==='pantry')!;
  expect(pantry.properties).toMatchObject({use:'utility',accessFrom:'kitchen'});expect(pantry.properties.attachedTo).toBeUndefined();expect(created.some(element=>element.kind==='door'&&element.properties.accessFrom==='kitchen'&&element.properties.accessTo==='pantry')).toBe(true);
  expect(String(provider.requests[0].instructions)).toContain('Every non-bathroom room must use attachedTo:null');expect(String(provider.requests[0].instructions)).toContain('A pantry or laundry uses use:utility');expect(project).toEqual(before);expect(()=>applyProposal(project,proposal)).not.toThrow();
  const invalidEnsuite={...spec,rooms:rooms.map(room=>room.key==='ensuite'?{...room,attachedTo:'kitchen'}:room)};expect(()=>buildProposal(layoutOutput(invalidEnsuite),{project,selectedIds:[],prompt:'Invalid ensuite target'},DEFAULT_AI_MODEL)).toThrow(/attached bathroom must reference a primary bedroom/);
 });
});
describe('supported house creation through structured provider operations',()=>{
 it('turns the reported house request into a detached room/wall/opening preview without requiring dimensions or existing edit targets',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');vi.stubEnv('OPENAI_MODEL','');provider.response={status:'completed',output_parsed:layoutOutput()};
  const project=createBlankProject('New house'),before=structuredClone(project),proposal=await requestProposal({project,selectedIds:[],activeLevelId:'level-0',prompt:'Make a house. small house. 2 bedrooms with attached bathrooms, 1 common bathroom, 1 living room, 1 home theater, 1 indoor swimming pool.'});
  expect(proposal.kind).toBe('layout');expect(proposal.model).toBe(DEFAULT_AI_MODEL);expect(proposal.layout).toMatchObject({baselineVersion:project.version,footprintId:null,width:null,depth:null});expect(proposal.changes).toEqual([]);expect(project).toEqual(before);
  const elements=proposal.creations!.map(item=>item.after),programRooms=elements.filter(element=>element.kind==='room'&&element.properties.layoutKey!=='circulation'&&element.properties.use!=='circulation');expect(programRooms).toHaveLength(8);expect(programRooms.filter(element=>element.properties.use==='bedroom')).toHaveLength(2);expect(programRooms.filter(element=>element.properties.use==='bathroom')).toHaveLength(3);expect(programRooms.find(element=>element.properties.use==='pool')?.properties.reservedZone).toBe(true);
  expect(elements.some(element=>element.kind==='wall')).toBe(true);expect(elements.some(element=>element.kind==='door')).toBe(true);expect(elements.some(element=>element.kind==='window')).toBe(true);expect(proposal.issues.join(' ')).toMatch(/reserved room zone|specialist/i);expect(proposal.issues.join(' ')).toMatch(/Unspecified room areas/);expect(elements.length).toBeLessThanOrEqual(200);
  const accepted=applyProposal(project,proposal);expect(accepted.elements).toEqual(elements);expect(accepted.version).toBe(project.version+1);expect(project).toEqual(before);
 });
 it('uses exactly the selected slab without resizing or editing it, and rejects incompatible selection and mixed operations',()=>{
  const project=createBlankProject('Selected footprint'),source=createDemoProject().elements.find(element=>element.kind==='slab')!;project.elements=[{...source,id:'selected-footprint',levelId:'level-0',x:10,y:20,width:16,depth:20,rotation:25}];const original=structuredClone(project),layout={...houseProgram,footprintId:'selected-footprint'},input={project,selectedIds:['selected-footprint'],activeLevelId:'level-0',prompt:'Create the requested house on this slab'};
  const proposal=buildProposal(layoutOutput(layout),input,DEFAULT_AI_MODEL),accepted=applyProposal(project,proposal);expect(project).toEqual(original);expect(accepted.elements.find(element=>element.id==='selected-footprint')).toEqual(original.elements[0]);expect(proposal.creations!.every(item=>item.elementId!=='selected-footprint')).toBe(true);
  expect(()=>buildProposal(layoutOutput(layout),{...input,selectedIds:[]},DEFAULT_AI_MODEL)).toThrow(/Select.*slab/);expect(()=>buildProposal(layoutOutput(),input,DEFAULT_AI_MODEL)).toThrow(/exact selected slab/);expect(()=>buildProposal({...layoutOutput(layout),operations:[...layoutOutput(layout).operations,...layoutOutput(layout).operations]},input,DEFAULT_AI_MODEL)).toThrow(/separate preview/);
 });
});


describe('two-storey and replan provider contract',()=>{
 it('produces the real strict OpenAI schema with required nullable additions while accepting old stored programs',()=>{
  const format=zodTextFormat(aiOutputSchema,'bim_proposal'),schema=JSON.parse(JSON.stringify(format.schema));
  const create=schema.properties.operations.items.anyOf.find((value:any)=>value.properties.action.const==='create-layout').properties.layout;
  expect(format.strict).toBe(true);expect(create.required).toEqual(expect.arrayContaining(['storeys','floorHeight','replaceConcept']));
  for(const branch of create.properties.rooms.items.anyOf){expect(branch.required).toContain('floor');expect(JSON.stringify(branch.properties.floor)).toContain('null');}
  for(const key of ['storeys','floorHeight','replaceConcept'])expect(JSON.stringify(create.properties[key])).toContain('null');
  expect(layoutOutput().operations).toHaveLength(1);
 });

 it('delegates unspecified new two-storey floor assignments to residential zoning rather than inventing guest-floor constraints',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');
  const bedrooms=Array.from({length:4},(_,index)=>[{key:`bed-${index+1}`,name:`Bedroom ${index+1}`,use:'bedroom' as const,area:null,attachedTo:null,floor:null},{key:`ensuite-${index+1}`,name:`Ensuite ${index+1}`,use:'bathroom' as const,area:null,attachedTo:`bed-${index+1}`,floor:null}]).flat();
  const facilities:LayoutSpec['rooms']=[{key:'living',name:'Living',use:'living',area:null,attachedTo:null,floor:null},{key:'dining',name:'Dining',use:'dining',area:null,attachedTo:null,floor:null},{key:'kitchen',name:'Kitchen',use:'kitchen',area:null,attachedTo:null,floor:null},{key:'utility',name:'Utility',use:'utility',area:null,attachedTo:null,floor:null},{key:'common-bath',name:'Common bathroom',use:'bathroom',area:null,attachedTo:null,floor:null}];
  provider.response={status:'completed',output_parsed:layoutOutput({...houseProgram,storeys:2,replaceConcept:false,rooms:[...bedrooms,...facilities]})};
  const project=createBlankProject('Four-bedroom concept'),before=structuredClone(project),p=await requestProposal({project,selectedIds:[],prompt:'Make a new four-bedroom two-storey house. Other details according to your liberty.'}),instructions=String(provider.requests[0].instructions);
  expect(instructions).toContain('For NEW two-storey creation, set room.floor:null for EVERY requested or proposed program room unless the user explicitly specifies');
  expect(instructions).toContain('are not explicit floor constraints');expect(instructions).toContain('proposed facilities also use floor:null');expect(instructions).toContain('engine-proposed zoning');
  expect(instructions).toContain('Preserve an explicitly requested ground-floor bedroom');expect(instructions).toContain('Preserve existing floor wishes during replanning');
  expect(p.layout!.rooms).toHaveLength(13);expect(p.layout!.rooms.every(room=>room.floor===null)).toBe(true);
  const upper=p.levelCreations![0].levelId,bedroomElements=p.creations!.filter(item=>item.after.kind==='room'&&item.after.properties.use==='bedroom');
  expect(bedroomElements).toHaveLength(4);expect(bedroomElements.every(item=>item.after.levelId===upper)).toBe(true);expect(project).toEqual(before);
 });

 it('sends the complete existing program and actual floor provenance without merging another house or circulation',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');provider.response={status:'completed',output_parsed:{summary:'Analysis only',operations:[],issues:[]}};
  const project=createBlankProject('Existing nine-room home');project.levels.push({id:'upper',name:'Upper floor',elevation:3.2},{id:'other-base',name:'Other building',elevation:20});
  const room=(key:string,name:string,use:string,floor:0|1,attachedTo:string|null=null,generation='existing-house'):BimElement=>({id:`${generation}-room-${key}`,kind:'room',name,levelId:generation==='other-house'?'other-base':floor===1?'upper':'level-0',typeId:'room-default',material:'Not applicable',x:0,y:0,z:floor*3.2,width:4,depth:4,height:.02,rotation:0,editable:true,properties:{conceptLayout:true,conceptGeneration:generation,layoutBaseLevelId:generation==='other-house'?'other-base':'level-0',layoutStoreys:generation==='other-house'?1:2,floorIndex:floor,layoutKey:key,use,requestedArea:use==='bathroom'?4.5:16,...(attachedTo?{attachedTo}:{})}});
  project.elements=[room('bed-1','Bedroom 1','bedroom',1),room('bed-2','Bedroom 2','bedroom',1),room('bed-3','Bedroom 3','bedroom',1),room('bath-1','Attached bathroom 1','bathroom',1,'bed-1'),room('bath-2','Attached bathroom 2','bathroom',1,'bed-2'),room('bath-3','Common bathroom','bathroom',0),room('kitchen','Kitchen','kitchen',0),room('library','Library','study',0),room('pool','Swimming pool zone','pool',0),room('circulation','Generated circulation','circulation',0),room('other','Other building bedroom','bedroom',0,null,'other-house')];
  const original=structuredClone(project);await requestProposal({project,selectedIds:[],activeLevelId:'upper',prompt:'Improve the existing two-storey house while keeping all rooms'});
  const request=provider.requests[0],sent=JSON.parse(String(request.input));expect(sent.capabilities.createLayout.storeys).toEqual([1,2]);expect(sent.capabilities.createLayout.manualGeometryReplacement).toBe(false);
  expect(sent.existingRoomProgram).toHaveLength(9);expect(sent.existingRoomProgram.map((item:any)=>item.name)).toContain('Library');expect(sent.existingRoomProgram.some((item:any)=>item.name.includes('Other building')||item.use==='circulation')).toBe(false);
  expect(sent.existingConceptContext.target).toMatchObject({generation:'existing-house',baseLevelId:'level-0',storeys:2});expect(sent.existingConceptContext.ambiguous).toBe(false);
  expect(sent.existingRoomProgram.find((item:any)=>item.key==='bath-1')).toMatchObject({attachedTo:'bed-1',floor:1,levelId:'upper',levelElevation:3.2,area:4.5});
  expect(String(request.instructions)).toContain('preserve every existing program room');expect(String(request.instructions)).toContain('Never combine distinct generation groups');expect(String(request.instructions)).toContain('do not claim daylight optimization');expect(String(request.instructions)).toContain('use width:null and depth:null by default');expect(String(request.instructions)).toContain('old model dimensions are context');expect(String(request.instructions)).toContain('do not promise a compact hub');expect(()=>buildProposal(layoutOutput({...houseProgram,levelId:'other-base',replaceConcept:true}),{project,selectedIds:[],activeLevelId:'upper',prompt:'Improve the current house'},DEFAULT_AI_MODEL)).toThrow(/different concept building/);expect(project).toEqual(original);
 });

 it('does not merge repeated houses that inherited the same generation marker and room keys',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');provider.response={status:'completed',output_parsed:{summary:'Select a bounded footprint',operations:[],issues:[]}};
  const project=createBlankProject('Copied concepts');const room:BimElement={id:'source-room-bed',kind:'room',name:'Bedroom',levelId:'level-0',typeId:'room-default',material:'Not applicable',x:1,y:1,z:0,width:4,depth:4,height:.02,rotation:0,editable:true,properties:{conceptLayout:true,conceptGeneration:'same-generation',layoutBaseLevelId:'level-0',layoutStoreys:1,floorIndex:0,layoutKey:'bed',use:'bedroom'}};project.elements=[room,{...structuredClone(room),id:'translated-copy',x:100}];
  const context={project,selectedIds:[],activeLevelId:'level-0',prompt:'Improve the existing concept'};await requestProposal(context);let sent=JSON.parse(String(provider.requests[0].input));expect(sent.existingConceptContext.ambiguous).toBe(true);expect(sent.existingRoomProgram).toEqual([]);expect(()=>buildProposal(layoutOutput({...houseProgram,replaceConcept:true}),context,DEFAULT_AI_MODEL)).toThrow(/More than one concept/);
  project.elements.push({id:'selected-boundary',kind:'slab',name:'Ground boundary',levelId:'level-0',typeId:'slab-concrete',material:'Reinforced concrete',x:0,y:0,z:-.2,width:10,depth:10,height:.2,rotation:0,editable:true,properties:{}});await requestProposal({...context,selectedIds:['selected-boundary']});sent=JSON.parse(String(provider.requests[1].input));expect(sent.existingConceptContext.ambiguous).toBe(false);expect(sent.existingRoomProgram).toHaveLength(1);expect(sent.existingRoomProgram[0].elementId).toBe(room.id);
 });

 it('proposes both floors and a separately reviewed level without canonical mutation',()=>{
  const project=createBlankProject('Two-storey house'),before=structuredClone(project),spec:LayoutSpec={...houseProgram,storeys:2,floorHeight:3.2,replaceConcept:false,rooms:houseProgram.rooms.map(room=>({...room,floor:room.use==='bedroom'||room.attachedTo?1:0}))};
  const p=buildProposal(layoutOutput(spec),{project,selectedIds:[],activeLevelId:'level-0',prompt:'Make a two-storey house with both bedrooms and attached bathrooms upstairs'},DEFAULT_AI_MODEL);
  expect(p.levelCreations).toHaveLength(1);expect(p.removals).toEqual([]);expect(p.summary).toMatch(/2-storey/);expect(p.issues.join(' ')).toMatch(/exterior.window.*proxy/i);expect(project).toEqual(before);
  const accepted=applyProposal(project,p);expect(accepted.levels).toHaveLength(2);expect(accepted.elements.some(element=>element.kind==='stair')).toBe(true);expect(accepted.version).toBe(project.version+1);
 });

 it('rejects a selected upper concept slab piece with clear guidance while allowing a manual upper footprint creation',()=>{
  const blank=createBlankProject('Upper piece'),first=buildProposal(layoutOutput({...houseProgram,storeys:2,floorHeight:3.2}),{project:blank,selectedIds:[],prompt:'Create two storeys'},DEFAULT_AI_MODEL),project=applyProposal(blank,first),upper=project.levels.find(level=>level.id!=='level-0')!,piece=project.elements.find(element=>element.kind==='slab'&&element.levelId===upper.id)!;
  expect(()=>buildProposal(layoutOutput({...houseProgram,levelId:upper.id,footprintId:piece.id,storeys:2,replaceConcept:true}),{project,selectedIds:[piece.id],activeLevelId:upper.id,prompt:'Improve the entire house'},DEFAULT_AI_MODEL)).toThrow(/Clear the selection.*whole house/);
  const valid=buildProposal(layoutOutput({...houseProgram,storeys:2,replaceConcept:true}),{project,selectedIds:[],activeLevelId:upper.id,prompt:'Improve the entire house'},DEFAULT_AI_MODEL),forged=structuredClone(valid);forged.selectedIds=[piece.id];forged.layout!.footprintId=piece.id;forged.layout!.levelId=upper.id;expect(()=>applyProposal(project,forged)).toThrow(/Clear the selection.*whole house/);
  const manual=createBlankProject('Manual upper footprint');manual.levels.push(upper);const footprint:BimElement={id:'manual-upper-footprint',kind:'slab',name:'Authored upper slab',levelId:upper.id,typeId:'slab-concrete',material:'Reinforced concrete',x:0,y:0,z:upper.elevation-.2,width:16,depth:20,height:.2,rotation:0,editable:true,properties:{}};manual.elements=[footprint];const p=buildProposal(layoutOutput({...houseProgram,levelId:upper.id,footprintId:footprint.id,storeys:1,replaceConcept:false}),{project:manual,selectedIds:[footprint.id],activeLevelId:upper.id,prompt:'Create a single-floor plan on this upper slab'},DEFAULT_AI_MODEL);expect(p.levelCreations).toEqual([]);expect(p.removals).toEqual([]);expect(p.creations!.every(item=>item.after.levelId===upper.id)).toBe(true);expect(applyProposal(manual,p).elements.find(element=>element.id===footprint.id)).toEqual(footprint);
 });

 it('replans from the upper active view using the house base and keeps its storeys when unspecified',()=>{
  const blank=createBlankProject('Replan existing house'),first=buildProposal(layoutOutput({...houseProgram,storeys:2,floorHeight:3.2,rooms:houseProgram.rooms.map(room=>({...room,floor:room.use==='bedroom'||room.attachedTo?1:0}))}),{project:blank,selectedIds:[],prompt:'Create the complete house with two storeys'},DEFAULT_AI_MODEL),project=applyProposal(blank,first),upper=project.levels.find(level=>level.id!=='level-0')!;
  const before=structuredClone(project),replan=buildProposal(layoutOutput({...houseProgram,levelId:upper.id,storeys:null,floorHeight:3.2,replaceConcept:true,rooms:houseProgram.rooms.map(room=>({...room,floor:room.use==='bedroom'||room.attachedTo?1:0}))}),{project,selectedIds:[],activeLevelId:upper.id,prompt:'Improve the existing house, keeping all rooms and both floors'},DEFAULT_AI_MODEL);
  expect(replan.layout).toMatchObject({levelId:'level-0',storeys:2,replaceConcept:true});expect(replan.removals!.length).toBeGreaterThan(0);expect(replan.levelCreations).toEqual([]);expect(replan.summary).toMatch(/Replan.*2-storey.*replaced concept elements/);expect(project).toEqual(before);
  const accepted=applyProposal(project,replan);expect(accepted.levels).toHaveLength(2);expect(accepted.elements.filter(element=>element.kind==='room'&&houseProgram.rooms.some(room=>room.key===element.properties.layoutKey))).toHaveLength(8);
 });
});

describe('bounded conversational design context',()=>{
 const turn=(proposal:ReturnType<typeof buildProposal>,status:'proposed'|'analysis'|'applied'|'rejected'|'superseded'='proposed')=>({id:proposal.id,prompt:proposal.prompt,summary:proposal.summary,issues:proposal.issues,kind:proposal.kind,selectedIds:proposal.selectedIds,status,projectVersion:proposal.layout?.baselineVersion??1,createdAt:proposal.createdAt,...(proposal.layout?{layout:proposal.layout}:{})});
 it('carries the complete unapplied programme through short follow-ups against the unchanged live base',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');
  const project=createBlankProject('Conversational house'),program={...houseProgram,storeys:2 as const,floorHeight:3.2,rooms:[...houseProgram.rooms,{key:'kitchen',name:'Kitchen',use:'kitchen' as const,area:12,attachedTo:null}]},pending=buildProposal(layoutOutput(program),{project,selectedIds:[],prompt:'Two floors, two bedrooms with ensuites, a common bathroom, living, home theater, pool and kitchen.'},DEFAULT_AI_MODEL),before=structuredClone(project);
  const clarification={...turn(pending),id:'clarification',prompt:'Make kitchen bigger',summary:'What net kitchen area would you prefer?',issues:[],kind:'analysis' as const,status:'analysis' as const,layout:undefined};
  for(const prompt of ['make kitchen bigger','keep 2 floors','yes','18 m²']){
   const revised={...program,storeys:null,floorHeight:null,rooms:program.rooms.map(room=>room.key==='kitchen'?{...room,area:18}:room)};provider.response={status:'completed',output_parsed:layoutOutput(revised)};
   const proposal=await requestProposal({project,selectedIds:[],prompt,conversation:[turn(pending),clarification],pendingProposal:pending}),sent=JSON.parse(String(provider.requests.at(-1)!.input));
   expect(sent.pendingLayoutIntent).toMatchObject({id:pending.id,status:'unapplied',baseProjectVersion:project.version,draftElementIdsAreNotLive:true,layout:{storeys:2,rooms:program.rooms}});expect(sent.pendingLayoutIntent).not.toHaveProperty('creations');
   expect(sent.conversation[1].messages).toEqual([{role:'user',content:'Make kitchen bigger'},{role:'assistant',content:JSON.stringify({summary:clarification.summary,issues:[]})}]);expect(proposal.layout).toMatchObject({baselineVersion:project.version,levelId:'level-0',storeys:2,floorHeight:3.2});
   expect(proposal.layout!.rooms).toHaveLength(program.rooms.length);expect(proposal.layout!.rooms.find(room=>room.key==='bath-1')?.attachedTo).toBe('bed-1');expect(proposal.layout!.rooms.find(room=>room.key==='kitchen')?.area).toBe(18);expect(proposal.creations!.every(creation=>!pending.creations!.some(old=>old.elementId===creation.elementId))).toBe(true);expect(project).toEqual(before);
  }
  const instructions=String(provider.requests[0].instructions);expect(instructions).toContain('at most ONE genuinely blocking question');expect(instructions).toContain('latest user request overrides');expect(instructions).toContain('never use them in set-property');expect(instructions).toContain('An analysis/clarification turn does not discard');
 });
 it('bounds history with explicit statuses and never presents rejected/superseded drafts as applied',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');provider.response={status:'completed',output_parsed:{summary:'Analysis',operations:[],issues:[]}};
  const project=createBlankProject('Status context'),pending=buildProposal(layoutOutput(),{project,selectedIds:[],prompt:'Initial programme'},DEFAULT_AI_MODEL),history=Array.from({length:15},(_,index)=>({...turn(pending,index===14?'rejected':'superseded'),id:index===14?pending.id:`history-${index}`,prompt:`Prompt ${index}`}));
  await requestProposal({project,selectedIds:[],prompt:'Explain current state',conversation:history,pendingProposal:pending});const sent=JSON.parse(String(provider.requests[0].input));expect(sent.conversation).toHaveLength(12);expect(sent.conversation[0].messages[0].content).toBe('Prompt 3');expect(sent.conversation.at(-1).status).toBe('rejected');expect(sent.pendingLayoutIntent).toBeNull();expect(project.elements).toEqual([]);expect(provider.requests[0].store).toBe(false);
 });
 it('honours a latest explicit storey change instead of forcing the previous pending two-storey option',()=>{
  const project=createBlankProject('Changed brief'),pending=buildProposal(layoutOutput({...houseProgram,storeys:2}),{project,selectedIds:[],prompt:'Two storeys'},DEFAULT_AI_MODEL),revised=buildProposal(layoutOutput({...houseProgram,storeys:1}),{project,selectedIds:[],prompt:'Actually one storey',pendingProposal:pending,conversation:[turn(pending)]},DEFAULT_AI_MODEL);expect(revised.layout!.storeys).toBe(1);expect(revised.levelCreations).toEqual([]);
 });
 it('does not edit pending-only room IDs as though the preview was already applied',()=>{
  const project=createBlankProject('Unapplied room'),pending=buildProposal(layoutOutput(),{project,selectedIds:[],prompt:'House'},DEFAULT_AI_MODEL),draftRoom=pending.creations!.find(creation=>creation.after.kind==='room')!,output=aiOutputSchema.parse({summary:'Wrong edit',issues:[],operations:[{action:'set-property',elementIds:[draftRoom.elementId],property:'width',value:null,numericValue:5,typeId:null,crewCount:null,count:null,offsetX:null,offsetY:null}]});
  expect(()=>buildProposal(output,{project,selectedIds:[],prompt:'make it bigger',pendingProposal:pending,conversation:[turn(pending)]},DEFAULT_AI_MODEL)).toThrow(/Select the elements/);expect(project.elements).toEqual([]);
 });
});

describe('explicit live edit scope without manual selection',()=>{
 const edit=(elementIds:string[],property='specification',value='Reviewed option')=>aiOutputSchema.parse({summary:'Scoped edit',issues:[],operations:[{action:'set-property',elementIds,property,value,numericValue:null,typeId:null,crewCount:null,count:null,offsetX:null,offsetY:null}]});
 const replacement=(elementIds:string[])=>aiOutputSchema.parse({summary:'Window upgrade',issues:[],operations:[{action:'replace-type',elementIds,property:null,value:null,numericValue:null,typeId:'window-thermal',crewCount:null,count:null,offsetX:null,offsetY:null}]});
 it('resolves a uniquely named live element and explicit all-windows while reviewing the exact used IDs',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');const project=createDemoProject(),window=project.elements.find(element=>element.kind==='window')!,windows=project.elements.filter(element=>element.kind==='window').map(element=>element.id),before=structuredClone(project);
  provider.response={status:'completed',output_parsed:replacement([window.id])};let proposal=await requestProposal({project,selectedIds:[],prompt:`Upgrade ${window.name}`});expect(proposal.selectedIds).toEqual([window.id]);expect(JSON.parse(String(provider.requests[0].input)).resolvedEditScopeIds).toEqual([window.id]);
  proposal=buildProposal(replacement(windows),{project,selectedIds:[],prompt:'Upgrade all windows'},DEFAULT_AI_MODEL);expect(proposal.selectedIds).toEqual(windows);expect(proposal.changes).toHaveLength(windows.length);
  proposal=buildProposal(replacement([windows[0]]),{project,selectedIds:windows,prompt:'Upgrade selected windows'},DEFAULT_AI_MODEL);expect(proposal.selectedIds).toEqual([windows[0]]);expect(project).toEqual(before);
 });
 it('respects exact named floor qualifiers and declines unresolved spatial subsets instead of widening them',()=>{
  const project=createDemoProject(),ground=project.elements.filter(element=>element.kind==='window'&&element.levelId==='level-0').map(element=>element.id),upper=project.elements.find(element=>element.kind==='window'&&element.levelId==='level-1')!;
  expect(buildProposal(replacement(ground),{project,selectedIds:[],prompt:'Upgrade all windows on Ground floor'},DEFAULT_AI_MODEL).selectedIds).toEqual(ground);
  expect(()=>buildProposal(replacement([upper.id]),{project,selectedIds:[],prompt:'Upgrade all windows on Ground floor'},DEFAULT_AI_MODEL)).toThrow(/outside.*scope/);
  for(const prompt of ['Upgrade all windows in Kitchen','Upgrade all windows facing south','Upgrade all windows upstairs'])expect(()=>buildProposal(replacement(ground),{project,selectedIds:[],prompt},DEFAULT_AI_MODEL)).toThrow(/Select the elements/);
 });
 it('rejects duplicated names, exclusions, old-history target guesses and output outside actual selection',()=>{
  const project=createDemoProject(),windows=project.elements.filter(element=>element.kind==='window'),first=windows[0],second=windows[1];first.name='Kitchen window';second.name='Kitchen window';
  expect(()=>buildProposal(replacement([first.id]),{project,selectedIds:[],prompt:'Upgrade Kitchen window'},DEFAULT_AI_MODEL)).toThrow(/Select the elements/);
  expect(()=>buildProposal(replacement([first.id]),{project,selectedIds:[],prompt:'Upgrade all windows except the kitchen'},DEFAULT_AI_MODEL)).toThrow(/Select the elements/);
  const prior={id:'old',prompt:'Upgrade prior window',summary:'Window option',issues:[],kind:'edit' as const,selectedIds:[first.id],status:'applied' as const,projectVersion:1,createdAt:new Date().toISOString()};
  expect(()=>buildProposal(replacement([first.id]),{project,selectedIds:[],prompt:'Upgrade another window',conversation:[prior]},DEFAULT_AI_MODEL)).toThrow(/Select the elements/);
  expect(()=>buildProposal(replacement([second.id]),{project,selectedIds:[first.id],prompt:`Upgrade ${second.name}`},DEFAULT_AI_MODEL)).toThrow(/outside.*scope/);
 });
 it('reuses only live prior IDs for a referential continuation and still enforces locks',()=>{
  const project=createDemoProject(),window=project.elements.find(element=>element.kind==='window')!,prior=buildProposal(edit([window.id]),{project,selectedIds:[window.id],prompt:'Set specification'},DEFAULT_AI_MODEL),turn={id:prior.id,prompt:prior.prompt,summary:prior.summary,issues:[],kind:prior.kind,selectedIds:prior.selectedIds,status:'proposed' as const,projectVersion:project.version,createdAt:prior.createdAt};
  expect(buildProposal(edit([window.id]),{project,selectedIds:[],prompt:'Change that specification',pendingProposal:prior,conversation:[turn]},DEFAULT_AI_MODEL).selectedIds).toEqual([window.id]);
  project.constraints.lockedElementIds=[window.id];expect(()=>buildProposal(edit([window.id]),{project,selectedIds:[],prompt:'Change that specification',pendingProposal:prior,conversation:[turn]},DEFAULT_AI_MODEL)).toThrow(/locked/);
  project.constraints.lockedElementIds=[];expect(()=>buildProposal(edit([window.id]),{project,selectedIds:[],prompt:'Change that specification',conversation:[{...turn,status:'rejected'}]},DEFAULT_AI_MODEL)).toThrow(/Select the elements/);
 });
 it('requires a coordinated replacement for generated room geometry rather than a disconnected semantic rectangle edit',()=>{
  const project=createBlankProject('Applied generated house'),first=buildProposal(layoutOutput({...houseProgram,storeys:2}),{project,selectedIds:[],prompt:'Create house'},DEFAULT_AI_MODEL),live=applyProposal(project,first),room=live.elements.find(element=>element.kind==='room'&&element.properties.layoutKey==='living')!,output=aiOutputSchema.parse({summary:'Incorrect rectangle-only edit',issues:[],operations:[{action:'set-property',elementIds:[room.id],property:'width',value:null,numericValue:room.width+1,typeId:null,crewCount:null,count:null,offsetX:null,offsetY:null}]});
  expect(()=>buildProposal(output,{project:live,selectedIds:[room.id],prompt:'Make living room bigger'},DEFAULT_AI_MODEL)).toThrow(/bounded local-room-edit/);
  const before=structuredClone(live);expect(()=>buildProposal(layoutOutput({...houseProgram,storeys:null,replaceConcept:true}),{project:live,selectedIds:[room.id],prompt:'Make living room bigger'},DEFAULT_AI_MODEL)).toThrow(/local room request cannot replace the whole house/);expect(live).toEqual(before);
  live.constraints.lockedElementIds=[room.id];expect(()=>buildProposal(layoutOutput({...houseProgram,replaceConcept:true}),{project:live,selectedIds:[room.id],prompt:'Replan house'},DEFAULT_AI_MODEL)).toThrow(/locked/);
 });
 it('uses selected generation to disambiguate two houses while rejecting mixed or manual context selections',()=>{
  const blank=createBlankProject('Two concept groups'),first=buildProposal(layoutOutput(),{project:blank,selectedIds:[],prompt:'Create house'},DEFAULT_AI_MODEL),project=applyProposal(blank,first),room=project.elements.find(element=>element.kind==='room'&&element.properties.layoutKey==='living')!,other={...structuredClone(room),id:'other-house-room-living',x:100,properties:{...room.properties,conceptGeneration:'other-house'}};project.elements.push(other);
  const proposal=buildProposal(layoutOutput({...houseProgram,replaceConcept:true}),{project,selectedIds:[room.id],prompt:'Replan this house'},DEFAULT_AI_MODEL);expect(proposal.removals!.some(removal=>removal.elementId===other.id)).toBe(false);expect(proposal.removals!.some(removal=>removal.elementId===room.id)).toBe(true);
  expect(()=>buildProposal(layoutOutput({...houseProgram,replaceConcept:true}),{project,selectedIds:[room.id,other.id],prompt:'Replan house'},DEFAULT_AI_MODEL)).toThrow(/More than one concept|Select one editable/);
  room.properties={};expect(()=>buildProposal(layoutOutput({...houseProgram,replaceConcept:true}),{project,selectedIds:[room.id],prompt:'Replan house'},DEFAULT_AI_MODEL)).toThrow(/More than one concept|Select one editable/);
 });
});

describe('instant selected generated room resizing',()=>{
 const fixture=()=>{
  const blank=createBlankProject('Five-bedroom house'),rooms:LayoutSpec['rooms']=Array.from({length:5},(_,index)=>[{key:`bed-${index+1}`,name:`Bedroom ${index+1}`,use:'bedroom' as const,area:14,attachedTo:null,floor:1 as const},{key:`ensuite-${index+1}`,name:`Ensuite ${index+1}`,use:'bathroom' as const,area:4.5,attachedTo:`bed-${index+1}`,floor:1 as const}]).flat();rooms.push({key:'living',name:'Living room',use:'living',area:20,attachedTo:null,floor:0},{key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null,floor:0});
  const first=buildProposal(layoutOutput({...houseProgram,storeys:2,floorHeight:3.8,rooms}),{project:blank,selectedIds:[],prompt:'Create five-bedroom house with attached bathrooms and two storeys at 3.8 m'},DEFAULT_AI_MODEL),project=applyProposal(blank,first),room=project.elements.find(element=>element.kind==='room'&&element.properties.layoutKey==='bed-5')!;
  return{project,room,rooms};
 };
 const history=(proposal:ReturnType<typeof buildProposal>,status:'proposed'|'applied'|'rejected')=>({id:proposal.id,prompt:proposal.prompt,summary:proposal.summary,issues:proposal.issues,kind:proposal.kind,selectedIds:proposal.selectedIds,status,projectVersion:proposal.localEdit!.baselineVersion,createdAt:proposal.createdAt,localEdit:proposal.localEdit,roomResize:proposal.roomResize});
 it('answers selected Bedroom5 bigger with an exact local +20% target while preserving the whole envelope and other floors',async()=>{
  vi.stubEnv('OPENAI_API_KEY','');const {project,room}=fixture();room.properties.requestedArea=1;const before=structuredClone(project),actual=room.width*room.depth;
  const proposal=await requestProposal({project,selectedIds:[room.id],prompt:'make the selected bedroom 5 bigger'}),target=Math.ceil(actual*1.2*1000)/1000,accepted=applyProposal(project,proposal),changed=accepted.elements.find(element=>element.id===room.id)!;
  expect(provider.calls).toBe(0);expect(proposal.model).toBe('Atelier planning engine');expect(proposal.kind).toBe('edit');expect(proposal.layout).toBeUndefined();expect(proposal.localEdit).toMatchObject({action:'resize-room',roomId:room.id,targetArea:target});expect(proposal.roomResize).toEqual({roomKey:'bed-5',roomName:'Bedroom 5',sourceArea:actual,targetArea:target});
  expect(changed.width*changed.depth).toBeCloseTo(target,8);expect(proposal.changes.some(item=>item.after.kind==='wall')).toBe(true);expect(proposal.issues.join(' ')).toContain('Assumption: Bedroom 5 +20% of its actual measured area');expect(project).toEqual(before);expect(accepted.levels).toEqual(project.levels);
  const touched=new Set([...proposal.changes.map(item=>item.elementId),...(proposal.removals??[]).map(item=>item.elementId)]);
  for(const element of before.elements.filter(element=>!touched.has(element.id)))expect(accepted.elements.find(item=>item.id===element.id)).toEqual(element);
  expect(before.elements.filter(element=>element.levelId!==room.levelId||['slab','stair'].includes(element.kind)||element.kind==='wall'&&element.properties.exterior===true).some(element=>touched.has(element.id))).toBe(false);
 });
 it('explains polygon or locked local geometry without a full-house fallback or provider call',async()=>{
  vi.stubEnv('OPENAI_API_KEY','');for(const mode of ['polygon','locked']as const){const {project,room}=fixture();if(mode==='polygon')room.footprint=[{x:0,y:0},{x:room.width,y:0},{x:0,y:room.depth}];else project.constraints.lockedElementIds=[room.id];const before=structuredClone(project),proposal=await requestProposal({project,selectedIds:[room.id],prompt:'Make Bedroom 5 more spacious'});expect(proposal.kind).toBe('analysis');expect(proposal.localEdit).toBeUndefined();expect(proposal.layout).toBeUndefined();expect(proposal.changes).toEqual([]);expect(proposal.issues.join(' ')).toMatch(/No whole-house replacement/);expect(project).toEqual(before);}expect(provider.calls).toBe(0);
 });
 it('corrects only10% against the original reference before and after acceptance using stable live room IDs',async()=>{
  vi.stubEnv('OPENAI_API_KEY','');const {project,room}=fixture(),initial=await requestProposal({project,selectedIds:[room.id],prompt:'Make Bedroom 5 bigger'}),source=initial.roomResize!.sourceArea,target=Math.ceil(source*1.1*1000)/1000;
  const pending=await requestProposal({project,selectedIds:[room.id],prompt:'only 10% instead',pendingProposal:initial,conversation:[history(initial,'proposed')]});expect(pending.roomResize).toMatchObject({sourceArea:source,targetArea:target});expect(pending.localEdit).toMatchObject({action:'resize-room',roomId:room.id});
  const accepted=applyProposal(project,initial),corrected=await requestProposal({project:accepted,selectedIds:[],prompt:'actually 10%',conversation:[history(initial,'applied')]});expect(corrected.roomResize).toMatchObject({sourceArea:source,targetArea:target});expect(corrected.localEdit).toMatchObject({roomId:room.id});const final=applyProposal(accepted,corrected).elements.find(element=>element.id===room.id)!;expect(final.width*final.depth).toBeCloseTo(target,8);expect(provider.calls).toBe(0);
 });
 it('uses a unique explicit room name instead of stale manual selection, and keeps an exact-area correction local',async()=>{
  vi.stubEnv('OPENAI_API_KEY','');const {project,room}=fixture(),other=project.elements.find(element=>element.kind==='room'&&element.properties.layoutKey==='kitchen')!,initial=await requestProposal({project,selectedIds:[other.id],prompt:'Make Bedroom 5 bigger'});
  expect(initial.selectedIds).toEqual([room.id]);expect(initial.issues.join(' ')).toContain('rather than the current selection');
  const target=16,revised=await requestProposal({project,selectedIds:[room.id],prompt:'16 m²',pendingProposal:initial,conversation:[history(initial,'proposed')]});expect(revised.localEdit).toMatchObject({roomId:room.id,targetArea:target});expect(revised.roomResize).toMatchObject({sourceArea:initial.roomResize!.sourceArea,targetArea:target});expect(provider.calls).toBe(0);
 });
 it('does not transfer a correction to another house or revive rejected/unrelated room intents',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');const {project,room}=fixture(),initial=await requestProposal({project,selectedIds:[room.id],prompt:'Make Bedroom 5 bigger'}),accepted=applyProposal(project,initial),other=fixture().project,levelMap=new Map(other.levels.map((level,index)=>[level.id,index?'other-upper':'other-base']));
  accepted.levels.push(...other.levels.map(level=>({...level,id:levelMap.get(level.id)!,elevation:level.elevation+20})));accepted.elements.push(...other.elements.map(element=>({...element,levelId:levelMap.get(element.levelId)!,x:element.x+100,z:element.z+20,properties:{...element.properties,layoutBaseLevelId:'other-base'}})));
  provider.response={status:'completed',output_parsed:{summary:'Identify the intended local correction',operations:[],issues:[]}};
  const switched=await requestProposal({project:accepted,selectedIds:[],activeLevelId:'other-base',prompt:'only 10% instead',conversation:[history(initial,'applied')]});expect(switched.kind).toBe('analysis');expect(switched.localEdit).toBeUndefined();
  const unrelated={id:'new-topic',prompt:'Change a window',summary:'Window option',kind:'edit' as const,status:'applied' as const,selectedIds:[],issues:[],projectVersion:accepted.version,createdAt:initial.createdAt};
  for(const turns of [[history(initial,'applied'),unrelated],[history(initial,'rejected')]]){const next=await requestProposal({project:accepted,selectedIds:[],prompt:'only 10% instead',conversation:turns});expect(next.kind).toBe('analysis');expect(next.localEdit).toBeUndefined();}expect(provider.calls).toBe(3);
 });
 it('leaves richer local phrasings to the provider but rejects a destructive create-layout response',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');const {project,room}=fixture();provider.response={status:'completed',output_parsed:layoutOutput({...houseProgram,replaceConcept:true})};
  await expect(requestProposal({project,selectedIds:[room.id],prompt:'Make Bedroom 5 bigger and put a study instead'})).rejects.toMatchObject({code:'AI_PROPOSAL_INVALID'});expect(project.elements.some(element=>element.id===room.id)).toBe(true);expect(provider.calls).toBe(1);
 });
});

describe('local room replacement intent and provider scope',()=>{
 function pair(){
  const project=createBlankProject('Local replacement'),native={conceptLayout:true,conceptGeneration:'local-house',layoutBaseLevelId:'level-0',layoutStoreys:2,floorIndex:0};project.levels.push({id:'upper-local',name:'Upper',elevation:3.2});
  const element=(id:string,kind:BimElement['kind'],x:number,y:number,width:number,depth:number,rotation=0,properties:BimElement['properties']={}):BimElement=>({id,kind,name:id,levelId:'level-0',typeId:kind==='room'?'room-default':kind==='wall'?'wall-aac':kind==='door'?'door-timber':'slab-concrete',material:kind==='room'?'Not applicable':kind==='wall'?'AAC block':kind==='door'?'Engineered timber':'Reinforced concrete',x,y,z:0,width,depth,height:kind==='room'?.02:kind==='wall'?3:kind==='door'?2.1:.2,rotation,editable:true,properties:{...native,...properties}});
  project.elements=[{...element('bed2','room',.2,.2,4,4,0,{layoutKey:'bed2',use:'bedroom',requestedArea:16}),name:'Bedroom 2'},{...element('bed3','room',4.4,.2,4,4,0,{layoutKey:'bed3',use:'bedroom',requestedArea:16}),name:'Bedroom 3'},element('partition','wall',4.4,.2,4,.2,90,{exterior:false}),element('front','wall',0,0,8.6,.2,0,{exterior:true}),element('rear','wall',0,4.2,8.6,.2,0,{exterior:true}),element('west','wall',.2,.2,4,.2,90,{exterior:true}),element('east','wall',8.6,.2,4,.2,90,{exterior:true}),{...element('internal-door','door',4.4,1.2,.9,.2,90,{accessFrom:'bed2',accessTo:'bed3'}),hostId:'partition'},element('slab','slab',0,0,8.6,4.4),{...element('upper-bed5','room',.2,.2,4,4,0,{layoutKey:'bed5',use:'bedroom'}),name:'Bedroom 5',levelId:'upper-local',z:3.2}];return project;
 }
 const edit=(value:unknown)=>aiOutputSchema.parse({summary:'Bounded local edit',issues:[],operations:[{action:'local-room-edit',edit:value}]});
 it.each(['remove bedroom 2 and 3 and put a study instead','replace Bedrooms2and3withstudy','replace the selected rooms with a study'])('physically replaces only the two requested rooms: %s',async prompt=>{
  vi.stubEnv('OPENAI_API_KEY','');const project=pair(),before=structuredClone(project),selection=prompt.includes('selected')?['bed2','bed3']:['upper-bed5'],proposal=await requestProposal({project,selectedIds:selection,prompt});
  expect(provider.calls).toBe(0);expect(proposal.kind).toBe('edit');expect(proposal.selectedIds).toEqual(['bed2','bed3']);expect(proposal.localEdit).toMatchObject({action:'replace-rooms',roomIds:['bed2','bed3'],name:'Study',use:'study'});expect(proposal.layout).toBeUndefined();expect(proposal.removals!.map(item=>item.elementId).sort()).toEqual(['bed3','internal-door','partition']);const after=applyProposal(project,proposal);expect(after.elements.find(element=>element.id==='bed2')).toMatchObject({name:'Study',properties:{use:'study'}});expect(after.elements.find(element=>element.id==='upper-bed5')).toEqual(before.elements.find(element=>element.id==='upper-bed5'));expect(project).toEqual(before);
 });
 it('keeps a remove-only request unapplied, then combines its immediate study follow-up into one local transaction',async()=>{
  vi.stubEnv('OPENAI_API_KEY','');const project=pair(),before=structuredClone(project),first=await requestProposal({project,selectedIds:[],prompt:'remove bedroom 2 and 3'});expect(first.kind).toBe('analysis');expect(first.changes).toEqual([]);expect(project).toEqual(before);
  const turn={id:first.id,prompt:first.prompt,summary:first.summary,kind:first.kind,issues:first.issues,selectedIds:[],status:'analysis' as const,projectVersion:project.version,createdAt:first.createdAt},next=await requestProposal({project,selectedIds:[],prompt:'put a study instead',conversation:[turn]});expect(next.localEdit).toMatchObject({action:'replace-rooms',roomIds:['bed2','bed3'],name:'Study'});expect(provider.calls).toBe(0);expect(project).toEqual(before);
 });
 it('accepts richer provider local operations only within explicit live room scope',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');const project=pair(),before=structuredClone(project);provider.response={status:'completed',output_parsed:edit({action:'replace-rooms',roomIds:['bed2','bed3'],name:'Reading study',use:'study'})};
  const proposal=await requestProposal({project,selectedIds:['bed2','bed3'],prompt:'Please combine these rooms into our reading study'});expect(proposal.localEdit).toMatchObject({action:'replace-rooms',name:'Reading study'});expect(provider.calls).toBe(1);expect(JSON.parse(String(provider.requests[0].input)).capabilities.localRoomEdit.supported).toBe(true);
  expect(()=>buildProposal(edit({action:'resize-room',roomId:'upper-bed5',targetArea:18}),{project,selectedIds:['bed2'],prompt:'Make the selected room slightly larger'},DEFAULT_AI_MODEL)).toThrow(/explicitly named or selected/);expect(project).toEqual(before);
 });
 it('revises the still-pending named pair from a richer deictic provider follow-up despite stale selection',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');const project=pair(),pending=await requestProposal({project,selectedIds:['upper-bed5'],prompt:'remove bedroom 2 and 3 and put a study instead'}),turn={id:pending.id,prompt:pending.prompt,summary:pending.summary,kind:pending.kind,issues:pending.issues,selectedIds:pending.selectedIds,status:'proposed' as const,projectVersion:project.version,createdAt:pending.createdAt,localEdit:pending.localEdit};
  provider.response={status:'completed',output_parsed:edit({action:'replace-rooms',roomIds:['bed2','bed3'],name:'Library',use:'study'})};
  const proposal=await requestProposal({project,selectedIds:['upper-bed5'],prompt:'those same two bedrooms become a library instead',pendingProposal:pending,conversation:[turn]});expect(proposal.localEdit).toMatchObject({roomIds:['bed2','bed3'],name:'Library'});expect(proposal.selectedIds).toEqual(['bed2','bed3']);const sent=JSON.parse(String(provider.requests[0].input));expect(sent.pendingLocalEdit.roomIds).toEqual(['bed2','bed3']);expect(sent.resolvedLocalRoomScopeIds).toEqual(['bed2','bed3']);
  expect(()=>buildProposal(edit({action:'replace-rooms',roomIds:['bed2','bed3'],name:'Library',use:'study'}),{project,selectedIds:['upper-bed5'],prompt:'those same two bedrooms become a library instead',conversation:[{...turn,status:'rejected'}]},DEFAULT_AI_MODEL)).toThrow(/explicitly named or selected/);
 });
 it('explains an infeasible local replacement without escalating to a whole house',async()=>{
  vi.stubEnv('OPENAI_API_KEY','');const project=pair();project.elements.find(element=>element.id==='bed3')!.x+=20;const before=structuredClone(project),proposal=await requestProposal({project,selectedIds:[],prompt:'remove bedroom 2 and 3 and put a study instead'});expect(proposal.kind).toBe('analysis');expect(proposal.changes).toEqual([]);expect(proposal.layout).toBeUndefined();expect(proposal.issues.join(' ')).toMatch(/No whole-house replacement/);expect(project).toEqual(before);expect(provider.calls).toBe(0);
 });
 it.each(['Remove Bedroom 2 and Bedroom 3 and put a study instead','Make Bedroom 2 bigger','Put a study instead','Do not replan the house; make Bedroom 2 bigger','Make Bedroom 2 bigger while the whole house stays unchanged'])('blocks create-layout escalation for local intent: %s',prompt=>{
  const project=pair(),before=structuredClone(project);expect(()=>buildProposal(layoutOutput({...houseProgram,replaceConcept:true}),{project,selectedIds:['bed2'],prompt},DEFAULT_AI_MODEL)).toThrow(/local room request cannot replace the whole house/);expect(project).toEqual(before);
 });
 it('keeps explain-only requests as analysis and requires exact live numbered rooms',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');const project=pair(),before=structuredClone(project);provider.response={status:'completed',output_parsed:{summary:'Explain the room replacement constraints',operations:[],issues:[]}};
  const explained=await requestProposal({project,selectedIds:['bed2'],prompt:'Explain why removing Bedroom 2 and Bedroom 3 changes the partition'});expect(explained.kind).toBe('analysis');expect(explained.changes).toEqual([]);expect(provider.calls).toBe(1);
  project.elements.push({...structuredClone(project.elements[0]),id:'duplicate-bed2',x:20});const ambiguous=await requestProposal({project,selectedIds:[],prompt:'remove bedroom 2 and 3 and put a study instead'});expect(ambiguous.kind).toBe('analysis');expect(ambiguous.issues.join(' ')).toMatch(/ambiguous/);expect(before.elements.every(element=>project.elements.some(current=>JSON.stringify(current)===JSON.stringify(element)))).toBe(true);
 });
});

describe('additive upper-floor copilot contract',()=>{
 const fixture=()=>{const blank=createBlankProject('Existing two-storey house'),rooms:LayoutSpec['rooms']=Array.from({length:5},(_,index)=>[{key:`bed-${index+1}`,name:`Bedroom ${index+1}`,use:'bedroom' as const,area:14,attachedTo:null,floor:1 as const},{key:`ensuite-${index+1}`,name:`Ensuite ${index+1}`,use:'bathroom' as const,area:4.5,attachedTo:`bed-${index+1}`,floor:1 as const}]).flat();rooms.push({key:'living',name:'Living',use:'living',area:20,attachedTo:null,floor:0},{key:'kitchen',name:'Kitchen',use:'kitchen',area:10,attachedTo:null,floor:0});const initial=buildProposal(layoutOutput({...houseProgram,rooms,storeys:2,floorHeight:3.8}),{project:blank,selectedIds:[],prompt:'Create a two-storey five-bedroom house'},DEFAULT_AI_MODEL);return applyProposal(blank,initial);};
 const programme:LayoutSpec['rooms']=[{key:'upper-theatre',name:'Home theatre',use:'theater',area:40,attachedTo:null,floor:null},{key:'upper-bathroom',name:'Bathroom',use:'bathroom',area:5,attachedTo:null,floor:null}];
 const output=(baseLevelId:string,rooms=programme)=>aiOutputSchema.parse({summary:'Add an upper floor while retaining the existing construction',issues:[],operations:[{action:'add-upper-floor',floor:{baseLevelId,rooms,floorHeight:3.8}}]});
 const turn=(proposal:ReturnType<typeof buildProposal>,status:'proposed'|'rejected'='proposed')=>({id:proposal.id,prompt:proposal.prompt,summary:proposal.summary,issues:proposal.issues,kind:proposal.kind,selectedIds:proposal.selectedIds,status,projectVersion:proposal.upperFloor!.baselineVersion,createdAt:proposal.createdAt,upperFloor:proposal.upperFloor});
 it('answers the exact huge-theatre/bathroom floor request without interviewing the user or rebuilding either existing floor',async()=>{
  vi.stubEnv('OPENAI_API_KEY','');const project=fixture(),before=structuredClone(project),selected=project.elements.find(element=>element.kind==='room'&&element.properties.layoutKey==='bed-5')!,top=project.levels.slice().sort((a,b)=>a.elevation-b.elevation).at(-1)!;
  const proposal=await requestProposal({project,selectedIds:[selected.id],activeLevelId:'level-0',prompt:'add a floor. in the new floor, there should be a huge home theatre and a bathroom'});expect(provider.calls).toBe(0);expect(proposal.kind).toBe('edit');expect(proposal.layout).toBeUndefined();expect(proposal.upperFloor).toMatchObject({baseLevelId:top.id,floorHeight:3.8,rooms:programme});expect(proposal.selectedIds).toEqual([]);expect(proposal.levelCreations).toHaveLength(1);expect(proposal.issues.join(' ')).toMatch(/40 m².*5 m²/);
  const accepted=applyProposal(project,proposal),added=proposal.levelCreations![0].after;expect(accepted.levels).toHaveLength(3);expect(added.elevation).toBeCloseTo(top.elevation+3.8,8);expect(accepted.elements.filter(element=>element.levelId===added.id&&element.kind==='room'&&element.properties.use!=='circulation').map(element=>element.properties.use).sort()).toEqual(['bathroom','theater']);
  for(const element of before.elements.filter(element=>element.kind==='room'||element.kind==='wall'))expect(accepted.elements.find(current=>current.id===element.id)).toEqual(element);expect(project).toEqual(before);
 });
 it('sends richer new-floor programmes to the provider with explicit third-floor capability and source top level',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');const project=fixture(),top=project.levels.slice().sort((a,b)=>a.elevation-b.elevation).at(-1)!;provider.response={status:'completed',output_parsed:output(top.id)};
  const proposal=await requestProposal({project,selectedIds:[],activeLevelId:'level-0',prompt:'Add an upper level above the existing house and plan a cinema with a washroom.'});expect(proposal.upperFloor?.baseLevelId).toBe(top.id);expect(provider.calls).toBe(1);const sent=JSON.parse(String(provider.requests[0].input));expect(sent.capabilities.addUpperFloor).toMatchObject({supported:true,retainsExistingFloors:true,beyondInitialTwoStoreys:true});expect(sent.upperFloorContext.baseLevelId).toBe(top.id);expect(String(provider.requests[0].instructions)).toContain('A third floor is supported through this addition operation');
 });
 it('retains the complete pending new-floor programme across a size follow-up against the unchanged live model',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');const project=fixture();project.elements.find(element=>element.kind==='room'&&element.properties.layoutKey==='living')!.name='Home theatre';const before=structuredClone(project),pending=await requestProposal({project,selectedIds:[],prompt:'add a floor with a huge home theatre and a bathroom'}),top=pending.upperFloor!.baseLevelId,rooms=programme.map(room=>room.key==='upper-theatre'?{...room,area:48}:room);provider.response={status:'completed',output_parsed:output(top,rooms)};
  const revised=await requestProposal({project,selectedIds:[],prompt:'Make the Home theatre bigger',pendingProposal:pending,conversation:[turn(pending)]});expect(revised.upperFloor?.rooms).toEqual(rooms);expect(revised.upperFloor?.baseLevelId).toBe(top);expect(revised.levelCreations).toHaveLength(1);expect(project).toEqual(before);const sent=JSON.parse(String(provider.requests[0].input));expect(sent.pendingUpperFloorIntent).toEqual({baseLevelId:top,rooms:programme,floorHeight:3.8});expect(sent.conversation[0].upperFloorIntent.rooms).toHaveLength(2);
  expect(()=>buildProposal(output(top,rooms),{project,selectedIds:[],prompt:'Make the proposed theatre45squaremetres',pendingProposal:pending,conversation:[turn(pending,'rejected')]},DEFAULT_AI_MODEL)).toThrow(/explicit new-floor request|still-pending/);
 });
 it('never substitutes a whole-house create-layout or lower-storey insertion for a new floor',()=>{
  const project=fixture(),before=structuredClone(project),room=project.elements.find(element=>element.kind==='room')!;
  for(const selectedIds of [[],[room.id]])expect(()=>buildProposal(layoutOutput({...houseProgram,replaceConcept:true}),{project,selectedIds,prompt:'Add another floor to this house with a huge theatre and bathroom'},DEFAULT_AI_MODEL)).toThrow(/add-upper-floor.*retain existing floors/);
  expect(()=>buildProposal(output('level-0'),{project,selectedIds:[],prompt:'Add an upper level above the existing house'},DEFAULT_AI_MODEL)).toThrow(/highest level/);expect(project).toEqual(before);
 });
 it('keeps initial house generation and local room edits separate from floor addition',async()=>{
  const project=fixture(),room=project.elements.find(element=>element.kind==='room'&&element.properties.layoutKey==='bed-5')!;vi.stubEnv('OPENAI_API_KEY','');const local=await requestProposal({project,selectedIds:[room.id],prompt:'Make Bedroom 5 bigger'});expect(local.localEdit?.action).toBe('resize-room');expect(local.upperFloor).toBeUndefined();expect(local.levelCreations).toBeUndefined();
  const blank=createBlankProject('New initial house'),initial=buildProposal(layoutOutput({...houseProgram,storeys:2}),{project:blank,selectedIds:[],prompt:'Create a new two-storey house'},DEFAULT_AI_MODEL);expect(initial.kind).toBe('layout');expect(initial.upperFloor).toBeUndefined();expect(initial.levelCreations).toHaveLength(1);
 });
});
