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
