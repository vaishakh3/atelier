import {afterEach,describe,it,expect,vi} from 'vitest';
import {APIConnectionTimeoutError} from 'openai/error';
const provider=vi.hoisted(()=>({status:401,calls:0,response:null as unknown,options:null as unknown,error:null as unknown,requests:[] as Record<string,unknown>[] }));
vi.mock('openai',()=>({default:class {constructor(options:unknown){provider.options=options;}responses={parse:async(request:Record<string,unknown>)=>{provider.calls++;provider.requests.push(request);if(provider.error)throw provider.error;if(provider.response)return provider.response;throw{status:provider.status,message:'Sensitive provider diagnostic: synthetic-credential-do-not-echo'};}};}}));
import {requestProposal,buildProposal,AI_REQUEST_TIMEOUT_MS,AI_MAX_OUTPUT_TOKENS} from '../server/copilot';
import {DEFAULT_AI_MODEL,resolveAiModel,aiModelLabel} from '../src/domain/aiConfig';
import {createDemoProject,createBlankProject} from '../src/domain/seed';
import {aiOutputSchema} from '../src/domain/schema';
import {applyProposal} from '../src/domain/transactions';
import type {LayoutSpec} from '../src/domain/types';
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
describe('supported house creation through structured provider operations',()=>{
 it('turns the reported house request into a detached room/wall/opening preview without requiring dimensions or existing edit targets',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');vi.stubEnv('OPENAI_MODEL','');provider.response={status:'completed',output_parsed:layoutOutput()};
  const project=createBlankProject('New house'),before=structuredClone(project),proposal=await requestProposal({project,selectedIds:[],activeLevelId:'level-0',prompt:'Make a house. small house. 2 bedrooms with attached bathrooms, 1 common bathroom, 1 living room, 1 home theater, 1 indoor swimming pool.'});
  expect(proposal.kind).toBe('layout');expect(proposal.model).toBe(DEFAULT_AI_MODEL);expect(proposal.layout).toMatchObject({baselineVersion:project.version,footprintId:null,width:null,depth:null});expect(proposal.changes).toEqual([]);expect(project).toEqual(before);
  const elements=proposal.creations!.map(item=>item.after),programRooms=elements.filter(element=>element.kind==='room'&&element.properties.layoutKey!=='circulation');expect(programRooms).toHaveLength(8);expect(programRooms.filter(element=>element.properties.use==='bedroom')).toHaveLength(2);expect(programRooms.filter(element=>element.properties.use==='bathroom')).toHaveLength(3);expect(programRooms.find(element=>element.properties.use==='pool')?.properties.reservedZone).toBe(true);
  expect(elements.some(element=>element.kind==='wall')).toBe(true);expect(elements.some(element=>element.kind==='door')).toBe(true);expect(elements.some(element=>element.kind==='window')).toBe(true);expect(proposal.issues.join(' ')).toMatch(/reserved room zone|specialist/i);expect(proposal.issues.join(' ')).toMatch(/Unspecified room areas/);expect(elements.length).toBeLessThanOrEqual(200);
  const accepted=applyProposal(project,proposal);expect(accepted.elements).toEqual(elements);expect(accepted.version).toBe(project.version+1);expect(project).toEqual(before);
 });
 it('uses exactly the selected slab without resizing or editing it, and rejects incompatible selection and mixed operations',()=>{
  const project=createBlankProject('Selected footprint'),source=createDemoProject().elements.find(element=>element.kind==='slab')!;project.elements=[{...source,id:'selected-footprint',levelId:'level-0',x:10,y:20,width:16,depth:20,rotation:25}];const original=structuredClone(project),layout={...houseProgram,footprintId:'selected-footprint'},input={project,selectedIds:['selected-footprint'],activeLevelId:'level-0',prompt:'Create the requested house on this slab'};
  const proposal=buildProposal(layoutOutput(layout),input,DEFAULT_AI_MODEL),accepted=applyProposal(project,proposal);expect(project).toEqual(original);expect(accepted.elements.find(element=>element.id==='selected-footprint')).toEqual(original.elements[0]);expect(proposal.creations!.every(item=>item.elementId!=='selected-footprint')).toBe(true);
  expect(()=>buildProposal(layoutOutput(layout),{...input,selectedIds:[]},DEFAULT_AI_MODEL)).toThrow(/Select.*slab/);expect(()=>buildProposal(layoutOutput(),input,DEFAULT_AI_MODEL)).toThrow(/exact selected slab/);expect(()=>buildProposal({...layoutOutput(layout),operations:[...layoutOutput(layout).operations,...layoutOutput(layout).operations]},input,DEFAULT_AI_MODEL)).toThrow(/separate preview/);
 });
});
