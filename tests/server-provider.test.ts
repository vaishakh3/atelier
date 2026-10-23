import {afterEach,describe,it,expect,vi} from 'vitest';
const provider=vi.hoisted(()=>({status:401,calls:0}));
vi.mock('openai',()=>({default:class {responses={parse:async()=>{provider.calls++;throw{status:provider.status,message:'Sensitive provider diagnostic: synthetic-credential-do-not-echo'};}};}}));
import {requestProposal} from '../server/copilot';
import {createDemoProject} from '../src/domain/seed';
afterEach(()=>{vi.unstubAllEnvs();provider.calls=0;});
const input=()=>({prompt:'Explain project',selectedIds:[],project:createDemoProject()});
describe('provider failures remain distinct from local account authentication',()=>{
 it('maps upstream401 to502 without exposing credentials or expiring the local identity',async()=>{vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');provider.status=401;const context=input(),before=structuredClone(context.project);let caught:unknown;try{await requestProposal(context);}catch(error){caught=error;}expect(caught).toMatchObject({status:502,code:'AI_PROVIDER_AUTH'});expect(String(caught)).not.toContain('synthetic-credential-do-not-echo');expect(context.project).toEqual(before);expect(provider.calls).toBe(1);});
 it('preserves quota429 as a provider-specific failure',async()=>{vi.stubEnv('OPENAI_API_KEY','synthetic-credential-do-not-echo');provider.status=429;await expect(requestProposal(input())).rejects.toMatchObject({status:429,code:'AI_RATE_LIMIT'});});
 it('reports missing configuration without making any provider request',async()=>{vi.stubEnv('OPENAI_API_KEY','');await expect(requestProposal(input())).rejects.toMatchObject({status:503,code:'AI_NOT_CONFIGURED'});expect(provider.calls).toBe(0);});
});
