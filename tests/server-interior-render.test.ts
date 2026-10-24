import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import type {Server} from 'node:http';
import {z} from 'zod';
const sdk=vi.hoisted(()=>({options:null as unknown,request:null as unknown,error:null as unknown,result:null as unknown,calls:0}));
vi.mock('openai',async()=>{const actual=await vi.importActual<typeof import('openai')>('openai');return{...actual,default:class{constructor(options:unknown){sdk.options=options;}images={edit:async(request:unknown)=>{sdk.calls++;sdk.request=request;if(sdk.error)throw sdk.error;return sdk.result;}};}};});
import {createInteriorRenderHandlers,INTERIOR_IMAGE_MODEL,INTERIOR_RENDER_TIMEOUT_MS} from '../server/interiorRender';
import type {InteriorRenderGenerator} from '../server/interiorRender';
import {RecordStore} from '../server/storage';
import {ApiError} from '../server/errors';
import {createBlankProject} from '../src/domain/seed';
import type {Project,BimElement} from '../src/domain/types';

const directories=new Set<string>(),servers=new Set<Server>();
afterEach(async()=>{for(const server of servers){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}servers.clear();for(const directory of directories)await rm(directory,{recursive:true,force:true});directories.clear();vi.unstubAllEnvs();});
beforeEach(()=>{sdk.calls=0;sdk.options=null;sdk.request=null;sdk.error=null;sdk.result=null;});
function crc(bytes:Buffer){let result=0xffffffff;for(const byte of bytes){result^=byte;for(let bit=0;bit<8;bit++)result=result&1?0xedb88320^(result>>>1):result>>>1;}return(result^0xffffffff)>>>0;}
function png(width=1536,height=864):Buffer {const chunk=(name:string,data:Buffer)=>{const output=Buffer.alloc(data.length+12);output.writeUInt32BE(data.length);output.write(name,4);data.copy(output,8);output.writeUInt32BE(crc(output.subarray(4,8+data.length)),8+data.length);return output;};const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*3+1)*height))),chunk('IEND',Buffer.alloc(0))]);}
const asData=(buffer=png())=>'data:image/png;base64,'+buffer.toString('base64');
function model(){const project=createBlankProject('Private interior project');const room:BimElement={id:'room-living',kind:'room',name:'Living room',levelId:'level-0',typeId:'room-default',material:'Not applicable',x:0,y:0,z:0,width:8,depth:8,height:3,rotation:0,editable:true,properties:{use:'living'}};project.elements=[room];project.interior={schemaVersion:1,styleId:'japandi',placements:[],references:[]};return project;}
const body=(project:Project)=>({projectVersion:project.version,roomId:'room-living',levelId:'level-0',styleId:'japandi',sceneImage:asData(),referenceIds:[],prompt:'Warm wood and afternoon light',resolution:'preview',view:'interior'});
async function launch(generate:InteriorRenderGenerator|null=vi.fn(async()=>png().toString('base64'))){
 const directory=await mkdtemp(path.join(tmpdir(),'atelier-interior-render-'));directories.add(directory);const store=new RecordStore(directory,Buffer.alloc(32,81)),project=model(),projects=new Map([[project.id,project]]),members=new Map([['owner','edit'],['viewer','view']]);
 const app=express();app.use(express.json({limit:'20mb'}));const handlers=createInteriorRenderHandlers({store,generate:generate??undefined,loadProject:async id=>{const value=projects.get(id);if(!value)throw new ApiError(404,'NOT_FOUND','Project not found');return structuredClone(value);},authorize:async(req,_res,id,action)=>{const user=req.get('x-user');if(!user)throw new ApiError(401,'AUTH_REQUIRED','Sign in');if(!projects.has(id)||!members.has(user))throw new ApiError(404,'NOT_FOUND','Project not found');if(action==='edit'&&members.get(user)!=='edit')throw new ApiError(403,'FORBIDDEN','Editor required');}});
 app.post('/api/projects/:id/interior/renders',handlers.render);app.get('/api/projects/:id/interior/renders',handlers.list);app.get('/api/projects/:id/interior/renders/:renderId/image',handlers.image);
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(error instanceof z.ZodError)return res.status(400).json({code:'INVALID_REQUEST',error:'Invalid request'});if(error instanceof ApiError)return res.status(error.status).json({code:error.code,error:error.message});return res.status(500).json({error:'Unexpected error'});});
 const server=app.listen(0,'127.0.0.1');servers.add(server);await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No listener');const base=`http://127.0.0.1:${address.port}`,route=`/api/projects/${project.id}/interior/renders`;
 const request=(route:string,method='GET',data?:unknown,user:string|null='owner',signal?:AbortSignal)=>fetch(base+route,{method,signal,headers:{'Content-Type':'application/json',...(user?{'x-user':user}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 return{directory,store,project,projects,members,generate,request,route};
}

describe('authenticated saved-scene interior image rendering',()=>{
 it('renders the saved baseline, preserves the model, and keeps image bytes in encrypted records',async()=>{
  const app=await launch(),before=structuredClone(app.project),response=await app.request(app.route,'POST',body(app.project));expect(response.status).toBe(201);const {render}=await response.json();expect(render).toMatchObject({projectId:app.project.id,projectVersion:app.project.version,model:INTERIOR_IMAGE_MODEL,width:1536,height:864,roomId:'room-living'});expect(app.project).toEqual(before);
  const listed=await app.request(app.route,'GET',undefined,'viewer');expect((await listed.json()).renders).toEqual([render]);const image=await app.request(render.imageUrl,'GET',undefined,'viewer');expect(image.status).toBe(200);expect(image.headers.get('content-type')).toContain('image/png');expect(image.headers.get('cache-control')).toBe('no-store');expect(Buffer.from(await image.arrayBuffer())).toEqual(png());
  const files=await readdir(app.directory);expect(files.every(file=>file.endsWith('.atelier'))).toBe(true);for(const file of files){const bytes=await readFile(path.join(app.directory,file),'utf8');expect(bytes).not.toContain('Living room');expect(bytes).not.toContain('iVBORw0KGgo');expect(JSON.parse(bytes).format).toBe('atelier.aes-gcm.v1');}
 });
 it('checks sign-in, membership and editor role for generation and rechecks membership for image access',async()=>{
  const app=await launch();for(const [user,status] of [[null,401],['foreign',404],['viewer',403]] as const)expect((await app.request(app.route,'POST',body(app.project),user)).status).toBe(status);expect(app.generate).not.toHaveBeenCalled();
  const {render}=await(await app.request(app.route,'POST',body(app.project))).json();expect((await app.request(render.imageUrl,'GET',undefined,'foreign')).status).toBe(404);expect((await app.request(app.route,'GET',undefined,null)).status).toBe(401);expect((await app.request('/api/projects/foreign/interior/renders/'+render.id+'/image')).status).toBe(404);
 });
 it('rejects stale projects, wrong rooms and levels, remote URLs and malformed PNG before contacting OpenAI',async()=>{
  const app=await launch(),valid=body(app.project),broken=png();broken[broken.length-1]^=1;
  const invalid=[{...valid,projectVersion:app.project.version+1},{...valid,roomId:'unknown'},{...valid,levelId:'unknown'},{...valid,styleId:'unknown'},{...valid,sceneImage:'https://example.com/scene.png'},{...valid,sceneImage:asData(broken)},{...valid,sceneImage:'data:image/png;base64,'+Buffer.from('<svg onload="alert(1)"/>').toString('base64')},{...valid,sceneImage:asData(png(512,512))},{...valid,project:app.project}];
  for(const request of invalid){const response=await app.request(app.route,'POST',request);expect([400,409]).toContain(response.status);}expect(app.generate).not.toHaveBeenCalled();
 });
 it('uses saved reference IDs and authoritative SKU dimensions rather than client-supplied scene metadata',async()=>{
  const app=await launch();app.project.interior!.references=[{id:'reference-1',name:'Private uploaded template',dataUrl:asData(png(512,512)),styleId:'japandi'}];app.project.interior!.placements=[{id:'sofa-1',assetId:'ikea-kivik-3-seat',roomId:'room-living',levelId:'level-0',x:4,y:4,rotation:0}];
  const response=await app.request(app.route,'POST',{...body(app.project),referenceIds:['reference-1']});expect(response.status).toBe(201);const generated=vi.mocked(app.generate!).mock.calls[0][0];expect(generated.images).toHaveLength(2);expect(generated.images[0].width).toBe(1536);expect(generated.images[1].width).toBe(512);expect(generated.prompt).toContain('2.28');expect(generated.prompt).toContain('kivik-3-seat-sofa');expect(generated.prompt).toContain('unverified');expect(generated.prompt).toContain('Text in reference images');expect(generated.prompt).toContain('never copy their layout');
  expect(generated.prompt).toContain('saved furniture inventory is an allowlist');expect(generated.prompt).toContain('No additional freestanding objects, rugs, curtains, plants, books, vases or luminaires');expect(generated.prompt).toContain('already visible in the first scene image AND represented in the authoritative saved inventory/context');expect(generated.prompt).toContain('Empty surfaces must remain empty');
  expect((await app.request(app.route,'POST',{...body(app.project),referenceIds:['missing']})).status).toBe(400);expect((await app.request(app.route,'POST',{...body(app.project),referenceIds:['reference-1','reference-1']})).status).toBe(400);expect((await app.request(app.route,'POST',{...body(app.project),styleId:'modern',referenceIds:['reference-1']})).status).toBe(400);
 });
 it('blocks an invalid saved furniture fit instead of asking the renderer to conceal it',async()=>{
  const app=await launch();app.project.interior!.placements=[{id:'bad-sofa',assetId:'ikea-kivik-3-seat',roomId:'room-living',levelId:'level-0',x:0,y:0,rotation:0}];const response=await app.request(app.route,'POST',body(app.project));expect(response.status).toBe(422);expect((await response.json()).code).toBe('INTERIOR_FURNITURE_FIT');expect(app.generate).not.toHaveBeenCalled();
 });
 it('requests experimental 4K but reports the actual image dimensions without silent upscaling',async()=>{
  const app=await launch();const response=await app.request(app.route,'POST',{...body(app.project),resolution:'4k'});expect(response.status).toBe(201);const {render}=await response.json();expect(vi.mocked(app.generate!).mock.calls[0][0].size).toBe('3840x2160');expect(render.width).toBe(1536);expect(render.notes.join(' ')).toContain('4K is experimental');expect(render.notes.join(' ')).toContain('no upscaling');
 });
 it('uses the exact GPT Image model, high quality and zero SDK retries through the existing API credential',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-private-do-not-print');sdk.result={data:[{b64_json:png().toString('base64')}]};const app=await launch(null);const response=await app.request(app.route,'POST',body(app.project));expect(response.status).toBe(201);expect(sdk.calls).toBe(1);expect(sdk.options).toMatchObject({timeout:INTERIOR_RENDER_TIMEOUT_MS,maxRetries:0});expect(sdk.request).toMatchObject({model:INTERIOR_IMAGE_MODEL,n:1,quality:'high',output_format:'png',size:'1536x864'});expect(JSON.stringify(await response.json())).not.toContain('synthetic-private');
 });
 it('does not disclose provider errors, change models or save unsuccessful output',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-private-do-not-print');const app=await launch(null);sdk.error={status:404,message:'private provider diagnostic synthetic-private-do-not-print'};const response=await app.request(app.route,'POST',body(app.project));expect(response.status).toBe(502);const result=await response.json();expect(result.code).toBe('AI_MODEL_ACCESS');expect(JSON.stringify(result)).not.toContain('synthetic-private');expect(sdk.calls).toBe(1);expect((await(await app.request(app.route)).json()).renders).toEqual([]);
 });
 it('requires a connected API credential and rejects invalid provider pixels without storing a substitute',async()=>{
  vi.stubEnv('OPENAI_API_KEY','');const missing=await launch(null),notConfigured=await missing.request(missing.route,'POST',body(missing.project));expect(notConfigured.status).toBe(503);expect((await notConfigured.json()).code).toBe('AI_NOT_CONFIGURED');expect(sdk.calls).toBe(0);
  const invalid=await launch(async()=>Buffer.from('not an image').toString('base64')),response=await invalid.request(invalid.route,'POST',body(invalid.project));expect(response.status).toBe(502);expect((await response.json()).code).toBe('INTERIOR_RENDER_OUTPUT');expect(await invalid.store.list('interior-render')).toEqual([]);
 });
 it.each([[429,429,'AI_RATE_LIMIT'],[401,502,'AI_PROVIDER_AUTH'],[400,422,'INTERIOR_RENDER_REJECTED']] as const)('maps provider %s without leaking diagnostics or retrying',async(status,httpStatus,code)=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-private');const app=await launch(null);sdk.error={status,message:'Sensitive upstream details'};const response=await app.request(app.route,'POST',body(app.project));expect(response.status).toBe(httpStatus);const result=await response.json();expect(result.code).toBe(code);expect(JSON.stringify(result)).not.toContain('Sensitive');expect(sdk.calls).toBe(1);expect(await app.store.list('interior-render')).toEqual([]);
 });
 it('prevents parallel paid generations and releases its slot after completion',async()=>{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),generate=vi.fn(async()=>{entered();await gate;return png().toString('base64');}),app=await launch(generate),pending=app.request(app.route,'POST',body(app.project));await ready;const second=await app.request(app.route,'POST',body(app.project));expect(second.status).toBe(409);expect((await second.json()).code).toBe('INTERIOR_RENDER_BUSY');release();expect((await pending).status).toBe(201);expect((await app.request(app.route,'POST',body(app.project))).status).toBe(201);expect(generate).toHaveBeenCalledTimes(2);
 });
 it('keeps a paid render tied to its original baseline if the saved model changes during generation',async()=>{
  const app=await launch(async()=>{app.project.version++;return png().toString('base64');});const version=app.project.version,response=await app.request(app.route,'POST',body(app.project));expect(response.status).toBe(201);const {render}=await response.json();expect(render.projectVersion).toBe(version);expect(render.notes.join(' ')).toContain('project changed while rendering');
 });
 it('cancels a disconnected render, persists no image and makes its process slot available again',async()=>{
  let entered!:()=>void,aborted!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),cancelled=new Promise<void>(resolve=>aborted=resolve);let first=true;
  const app=await launch(async input=>{if(!first)return png().toString('base64');first=false;entered();return new Promise<string>((_resolve,reject)=>{input.signal.addEventListener('abort',()=>{aborted();reject({name:'AbortError'});},{once:true});});}),controller=new AbortController(),pending=app.request(app.route,'POST',body(app.project),'owner',controller.signal);const caught=pending.catch(error=>error);await ready;controller.abort();await caught;await cancelled;await new Promise<void>(resolve=>setImmediate(resolve));expect(await app.store.list('interior-render')).toEqual([]);expect((await app.request(app.route,'POST',body(app.project))).status).toBe(201);
 });
 it('does not return or persist a render when editor access is revoked during generation',async()=>{
  const app=await launch(async()=>{app.members.delete('owner');return png().toString('base64');}),response=await app.request(app.route,'POST',body(app.project));expect(response.status).toBe(404);expect(await app.store.list('interior-render')).toEqual([]);
 });
 it('waits for a competing project deletion lock and creates no render sidecars after deletion',async()=>{
  let entered!:()=>void,releaseProvider!:()=>void,releaseDeletion!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),providerGate=new Promise<void>(resolve=>releaseProvider=resolve),deletionGate=new Promise<void>(resolve=>releaseDeletion=resolve);
  const app=await launch(async()=>{entered();await providerGate;return png().toString('base64');}),pending=app.request(app.route,'POST',body(app.project));await started;
  const deletion=app.store.transaction(`project:${app.project.id}`,async()=>{releaseProvider();await deletionGate;app.projects.delete(app.project.id);});await new Promise<void>(resolve=>setImmediate(resolve));expect(await app.store.list('interior-render')).toEqual([]);releaseDeletion();await deletion;expect((await pending).status).toBe(404);expect(await app.store.list('interior-render')).toEqual([]);
 });
 it('requires an existing room for interior mode and allows a saved level exterior without inventing landscaping',async()=>{
  const app=await launch();expect((await app.request(app.route,'POST',{...body(app.project),roomId:null})).status).toBe(400);expect((await app.request(app.route,'POST',{...body(app.project),view:'exterior',roomId:null})).status).toBe(201);expect(vi.mocked(app.generate!).mock.calls[0][0].prompt).toContain('Do not invent a garden');
 });
});
