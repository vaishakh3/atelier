import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile,open,symlink} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createCipheriv,randomBytes} from 'node:crypto';
import {RecordStore,deriveKey,digest,exportPortableBackup,importPortableBackup} from '../server/storage';
import {createDemoProject} from '../src/domain/seed';
import {projectSchema} from '../src/domain/schema';
import {IdentityService} from '../server/auth';
import {createApp} from '../server/app';
import type {ProjectRecord} from '../server/app';
const dirs:string[]=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function make(){const dir=await mkdtemp(path.join(tmpdir(),'atelier-store-'));dirs.push(dir);return{dir,store:new RecordStore(dir,Buffer.alloc(32,44))};}

describe('authenticated encrypted storage and integrity recovery',()=>{
 it('encrypts values with unique nonces, authenticates logical record identity and rejects the wrong key',async()=>{const {dir,store}=await make();const data={name:'Confidential courtyard project',version:1};await store.write('project:a',data);const first=await readFile(store.filename('project:a'),'utf8');expect(first).not.toContain(data.name);expect((await store.read('project:a'))).toEqual(data);await store.write('project:a',data);const second=await readFile(store.filename('project:a'),'utf8');expect(JSON.parse(first).iv).not.toBe(JSON.parse(second).iv);await writeFile(store.filename('project:b'),second);await expect(store.read('project:b')).rejects.toMatchObject({code:'STORAGE_INTEGRITY'});const wrong=new RecordStore(dir,Buffer.alloc(32,55));await expect(wrong.read('project:a')).rejects.toMatchObject({code:'STORAGE_INTEGRITY'});expect(await readFile(store.filename('project:a'),'utf8')).toBe(second);});
 it('recovers the latest checksum/authentication-valid generation and skips tampered newer backups',async()=>{const {dir,store}=await make();for(let version=1;version<=4;version++)await store.write('project:a',{version});const folder=path.join(dir,'.backups'),generations=(await readdir(folder)).sort().reverse();await writeFile(path.join(folder,generations[0]),'{corrupt latest backup');await writeFile(store.filename('project:a'),'corrupt primary');expect(await store.read('project:a')).toEqual({version:2});expect(await store.read('project:a')).toEqual({version:2});expect(store.diagnostics().events.some(event=>event.kind==='recovered')).toBe(true);});
 it('caps retained generations, leaves no temporary files and fails closed when every copy is corrupt',async()=>{const {dir,store}=await make();for(let version=1;version<=9;version++)await store.write('project:a',{version});expect(await readdir(path.join(dir,'.backups'))).toHaveLength(5);expect((await readdir(dir)).some(name=>name.endsWith('.tmp'))).toBe(false);for(const file of await readdir(path.join(dir,'.backups')))await writeFile(path.join(dir,'.backups',file),'bad backup');await writeFile(store.filename('project:a'),'bad primary');await expect(store.read('project:a')).rejects.toMatchObject({status:503,code:'STORAGE_INTEGRITY'});expect(await readFile(store.filename('project:a'),'utf8')).toBe('bad primary');});
 it('serializes complete read-modify-write transactions, including automatic recovery',async()=>{const {store}=await make();await store.write('project:a',{count:0});await Promise.all(Array.from({length:12},()=>store.transaction('project:a',async()=>{const current=await store.read('project:a')as{count:number};await store.write('project:a',{count:current.count+1});})));expect(await store.read('project:a')).toEqual({count:12});});
 it('creates portable encrypted backups with authenticated scope and verifies passwords and integrity',async()=>{const password='A portable backup password';const backup=await exportPortableBackup('project-a',{project:{name:'Private project'}},password);expect(JSON.stringify(backup)).not.toContain('Private project');expect((await importPortableBackup(backup,password)).value).toEqual({project:{name:'Private project'}});await expect(importPortableBackup(backup,'Wrong password')).rejects.toMatchObject({code:'BACKUP_INTEGRITY'});await expect(importPortableBackup({...backup,projectId:'another-project'},password)).rejects.toMatchObject({code:'BACKUP_INTEGRITY'});});
 it('marks stronger backup derivation explicitly, reads older backups and rejects unknown or downgraded KDF metadata',async()=>{
  const password='A legacy portable backup password',projectId='legacy-backup',createdAt='2026-10-23T00:00:00.000Z',salt=randomBytes(16),iv=randomBytes(12),key=await deriveKey(password,salt,1),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(`atelier-backup-v1|${projectId}|${createdAt}`));const value={name:'A genuine older backup'},ciphertext=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]),tag=cipher.getAuthTag();key.fill(0);
  const legacy={format:'atelier.backup.v1',projectId,createdAt,salt:salt.toString('base64'),payload:{format:'atelier.aes-gcm.v1',iv:iv.toString('base64'),tag:tag.toString('base64'),ciphertext:ciphertext.toString('base64'),checksum:digest(Buffer.concat([iv,tag,ciphertext]))}};
  expect((await importPortableBackup(legacy,password)).value).toEqual(value);
  const current=await exportPortableBackup(projectId,value,password);expect(current.kdfVersion).toBe(2);
  await expect(importPortableBackup({...current,kdfVersion:1},password)).rejects.toMatchObject({code:'BACKUP_INTEGRITY'});
  await expect(importPortableBackup({...current,kdfVersion:100000000},password)).rejects.toMatchObject({code:'INVALID_BACKUP'});
 });
 it('preserves plaintext generations separately without making them canonical rollback generations',async()=>{const {dir,store}=await make(),legacy=new RecordStore(dir);const data={project:{id:'project-old',version:1,name:'Legacy private recovery'}};await legacy.write('project:project-old',data);await legacy.write('project:project-old',{project:{...data.project,version:2}});await store.migrateLegacy(value=>value);expect((await readdir(dir)).some(name=>name.endsWith('.json'))).toBe(false);expect((await readdir(path.join(dir,'.backups'))).some(name=>name.includes('.json.'))).toBe(false);const keys=await store.list('project:');expect(keys).toHaveLength(2);const recovered=await store.read(keys.find(key=>key!=='project:project-old')!)as{project:{version:number}};expect(recovered.project.version).toBe(1);const sources=await store.list('legacy-source:');expect(sources).toHaveLength(2);for(const key of sources)expect(await readFile(store.filename(key),'utf8')).not.toContain('Legacy private recovery');await writeFile(store.filename('project:project-old'),'corrupt current');await expect(store.read('project:project-old')).rejects.toMatchObject({code:'STORAGE_INTEGRITY'});});
});

function record():ProjectRecord{return{project:createDemoProject(),versions:[],comments:[],members:{}};}
function validateLegacy(value:unknown):ProjectRecord {
 const data=value as ProjectRecord;
 return{project:projectSchema.parse(data.project),versions:(data.versions??[]).map(version=>({...version,project:projectSchema.parse(version.project)})),comments:data.comments??[],members:data.members??{}};
}
describe('non-destructive conflicting legacy migration',()=>{
 it('preserves encrypted canonical/access bytes and recovers an old-app edit with valid remapped history',async()=>{
  const {dir,store}=await make(),canonical=record();canonical.project.version=5;canonical.members={'user-owner':'admin'};
  await store.write('project:'+canonical.project.id,canonical);await store.write('access:'+canonical.project.id,{members:{'user-owner':'admin'}});
  const ciphertext=await readFile(store.filename('project:'+canonical.project.id),'utf8'),access=await readFile(store.filename('access:'+canonical.project.id),'utf8');
  const legacy=structuredClone(canonical);legacy.project.version=6;legacy.project.name='Older application unsaved house';legacy.project.elements[0].width+=1;
  legacy.members={'user-removed':'admin'};legacy.versions=[{id:'old-snapshot',label:'Legacy review',actor:'Unverified author',timestamp:'2026-10-20',project:structuredClone(legacy.project)}];
  legacy.comments=[{id:'old-comment',versionId:'old-snapshot',author:'Claimed owner',authorId:'user-removed',role:'admin',createdAt:'2026-10-20',text:'Retain this older design.'}];
  const source=JSON.stringify(legacy,null,2),filename=path.join(dir,canonical.project.id+'.json');await writeFile(filename,source);await store.migrateLegacy(validateLegacy);
  expect(await readFile(store.filename('project:'+canonical.project.id),'utf8')).toBe(ciphertext);expect(await readFile(store.filename('access:'+canonical.project.id),'utf8')).toBe(access);
  const keys=await store.list('project:');expect(keys).toHaveLength(2);const copy=await store.read(keys.find(key=>key!=='project:'+canonical.project.id)!,validateLegacy);
  expect(copy.project.name).toContain('recovered legacy copy');expect(copy.project.id).toMatch(/^project-legacy-/);expect(copy.project.elements).toEqual(legacy.project.elements);expect(copy.members).toEqual({});
  expect(copy.versions[0].project.id).toBe(copy.project.id);expect(copy.versions[0].id).not.toBe('old-snapshot');expect(copy.comments[0].versionId).toBe(copy.versions[0].id);expect(copy.comments[0]).not.toHaveProperty('authorId');expect(copy.comments[0]).not.toHaveProperty('role');expect(copy.comments[0].author).toContain('Imported legacy');expect(copy.project.audit[0].actor).toBe('System migration');
  const sources=await store.list('legacy-source:');expect(sources).toHaveLength(1);expect((await store.read(sources[0])as{content:string}).content).toBe(source);expect((await readdir(dir)).some(name=>name.endsWith('.json'))).toBe(false);
 });
 it('deduplicates a restart/reintroduced source even after the recovered copy has been edited',async()=>{
  const {dir,store}=await make(),canonical=record();await store.write('project:'+canonical.project.id,canonical);const legacy=structuredClone(canonical);legacy.project.name='An older-app change';const source=JSON.stringify(legacy),file=path.join(dir,canonical.project.id+'.json');
  await writeFile(file,source);await store.migrateLegacy(validateLegacy);const recovered=(await store.list('project:')).find(key=>key!=='project:'+canonical.project.id)!;const copy=await store.read(recovered,validateLegacy);copy.project.name='Architect edited the recovery';copy.project.version++;await store.write(recovered,copy);const changed=await readFile(store.filename(recovered),'utf8');
  await writeFile(file,source);const restart=new RecordStore(dir,Buffer.alloc(32,44));await Promise.all([restart.migrateLegacy(validateLegacy),restart.migrateLegacy(validateLegacy)]);
  expect(await restart.list('project:')).toHaveLength(2);expect(await restart.list('legacy-import:')).toHaveLength(1);expect(await readFile(store.filename(recovered),'utf8')).toBe(changed);expect((await readdir(dir)).some(name=>name.endsWith('.json'))).toBe(false);
 });
 it('retries an interrupted recovery without deleting its source or duplicating the verified copy',async()=>{
  const {dir,store}=await make(),canonical=record();await store.write('project:'+canonical.project.id,canonical);const legacy=structuredClone(canonical);legacy.project.name='Recover after interruption';const file=path.join(dir,canonical.project.id+'.json'),source=JSON.stringify(legacy);await writeFile(file,source);
  const write=store.write.bind(store),interrupted=vi.spyOn(store,'write').mockImplementation(async(key,value)=>{if(key.startsWith('legacy-import:')&&(value as{complete?:boolean}).complete)throw new Error('Simulated disk failure after copy verification');await write(key,value);});
  try{await expect(store.migrateLegacy(validateLegacy)).rejects.toMatchObject({code:'MIGRATION_FAILED'});expect(await readFile(file,'utf8')).toBe(source);expect(await store.list('project:')).toHaveLength(2);}finally{interrupted.mockRestore();}
  const copy=(await store.list('project:')).find(key=>key!=='project:'+canonical.project.id)!,verified=await readFile(store.filename(copy),'utf8');await store.migrateLegacy(validateLegacy);expect(await store.list('project:')).toHaveLength(2);expect(await readFile(store.filename(copy),'utf8')).toBe(verified);expect((await readdir(dir)).some(name=>name.endsWith('.json'))).toBe(false);
 });
 it('normalizes both records through validation and stable key order before deciding conflict',async()=>{
  const {dir,store}=await make(),canonical=record();await store.write('project:'+canonical.project.id,canonical);const bytes=await readFile(store.filename('project:'+canonical.project.id),'utf8');const project=Object.fromEntries(Object.entries(canonical.project).reverse());
  const legacy={comments:[],project,versions:[]};await writeFile(path.join(dir,canonical.project.id+'.json'),JSON.stringify(legacy));
  const defaults=(value:unknown)=>{const parsed=validateLegacy(value);parsed.project.schedule.holidays??=[];return parsed;};await store.migrateLegacy(defaults);
  expect(await store.list('project:')).toHaveLength(1);expect(await store.list('legacy-import:')).toHaveLength(0);expect(await readFile(store.filename('project:'+canonical.project.id),'utf8')).toBe(bytes);
 });
 it('keeps the explicitly unencrypted development migration restartable without treating markers as projects',async()=>{
  const {dir}=await make(),store=new RecordStore(dir),canonical=record();await writeFile(path.join(dir,canonical.project.id+'.json'),JSON.stringify(canonical));await store.migrateLegacy(validateLegacy);const older=structuredClone(canonical);older.project.name='Legacy development edit';await writeFile(path.join(dir,canonical.project.id+'.json'),JSON.stringify(older));await store.migrateLegacy(validateLegacy);await store.migrateLegacy(validateLegacy);expect(await store.list('project:')).toHaveLength(2);expect(await readdir(path.join(dir,'.legacy-sources'))).toHaveLength(2);
 });
 it('preserves history-only divergence instead of dropping a legacy snapshot/comment',async()=>{
  const {dir,store}=await make(),canonical=record();await store.write('project:'+canonical.project.id,canonical);const legacy=structuredClone(canonical);legacy.versions=[{id:'review-one',actor:'Author',label:'Older review',timestamp:'2026-10-20',project:structuredClone(canonical.project)}];legacy.comments=[{id:'comment-one',versionId:'review-one',author:'Reviewer',text:'A legacy-only note',createdAt:'2026-10-20'}];
  await writeFile(path.join(dir,canonical.project.id+'.json'),JSON.stringify(legacy));await store.migrateLegacy(validateLegacy);const recovered=await store.read((await store.list('project:')).find(key=>key!=='project:'+canonical.project.id)!,validateLegacy);expect(recovered.comments[0].text).toBe('A legacy-only note');
 });
 it('fails closed on broken input, invalid encrypted canonical and corrupt import markers',async()=>{
  const {dir,store}=await make(),canonical=record(),file=path.join(dir,canonical.project.id+'.json');await store.write('project:'+canonical.project.id,canonical);const ciphertext=await readFile(store.filename('project:'+canonical.project.id),'utf8');
  await writeFile(file,'broken private JSON');await expect(store.migrateLegacy(validateLegacy)).rejects.toMatchObject({code:'MIGRATION_FAILED'});expect(await readFile(file,'utf8')).toBe('broken private JSON');expect(await readFile(store.filename('project:'+canonical.project.id),'utf8')).toBe(ciphertext);
  const legacy=structuredClone(canonical);legacy.project.name='Conflicting variant';const source=JSON.stringify(legacy);await writeFile(file,source);await writeFile(store.filename('project:'+canonical.project.id),'invalid ciphertext');await expect(store.migrateLegacy(validateLegacy)).rejects.toMatchObject({code:'MIGRATION_FAILED'});expect(await readFile(file,'utf8')).toBe(source);expect(await readFile(store.filename('project:'+canonical.project.id),'utf8')).toBe('invalid ciphertext');
  await writeFile(store.filename('project:'+canonical.project.id),ciphertext);await store.migrateLegacy(validateLegacy);const marker=(await store.list('legacy-import:'))[0];await writeFile(store.filename(marker),'broken marker');await writeFile(file,source);await expect(store.migrateLegacy(validateLegacy)).rejects.toMatchObject({code:'MIGRATION_FAILED'});expect(await readFile(file,'utf8')).toBe(source);
 });
 it('does not restore a missing protected project from an older plaintext variant',async()=>{
  const {dir,store}=await make(),legacy=record();await store.write('access:'+legacy.project.id,{members:{'user-successor':'admin'}});const access=await readFile(store.filename('access:'+legacy.project.id),'utf8');await writeFile(path.join(dir,legacy.project.id+'.json'),JSON.stringify(legacy));await store.migrateLegacy(validateLegacy);
  await expect(store.read('project:'+legacy.project.id)).rejects.toMatchObject({code:'NOT_FOUND'});const recovered=await store.list('project:');expect(recovered).toHaveLength(1);expect(recovered[0]).toContain('project-legacy-');expect(await readFile(store.filename('access:'+legacy.project.id),'utf8')).toBe(access);
 });
 it('keeps a source that changes during migration and rejects symlink sources',async()=>{
  const {dir,store}=await make(),legacy=record(),file=path.join(dir,legacy.project.id+'.json'),raw=JSON.stringify(legacy);await writeFile(file,raw);let changed=false;const next={...legacy,project:{...legacy.project,name:'Changed by the old application'}};const updated=JSON.stringify(next);
  await expect(store.migrateLegacy(value=>{if(!changed){changed=true;writeFileSync(file,updated);}return validateLegacy(value);})).rejects.toMatchObject({code:'MIGRATION_FAILED'});expect(await readFile(file,'utf8')).toBe(updated);
  await store.migrateLegacy(validateLegacy);expect(await store.list('project:')).toHaveLength(2);
  const target=path.join(dir,'outside-project.txt');await writeFile(target,raw);await symlink(target,file);await expect(store.migrateLegacy(validateLegacy)).rejects.toMatchObject({code:'MIGRATION_FAILED'});expect(await readFile(target,'utf8')).toBe(raw);
 });
 it('bounds oversized files and migration batches without consuming sources',async()=>{
  const {dir,store}=await make(),file=path.join(dir,'project-oversized.json'),handle=await open(file,'w');await handle.truncate(129*1024*1024);await handle.close();await expect(store.migrateLegacy(validateLegacy)).rejects.toMatchObject({code:'MIGRATION_FAILED'});expect(await readdir(dir)).toContain('project-oversized.json');expect(await store.list('legacy-source:')).toEqual([]);await rm(file);
  await Promise.all(Array.from({length:513},(_,index)=>writeFile(path.join(dir,`project-${index}.json`),'{}')));await expect(store.migrateLegacy(validateLegacy)).rejects.toMatchObject({code:'MIGRATION_FAILED'});expect((await readdir(dir)).filter(name=>name.endsWith('.json'))).toHaveLength(513);expect(await store.list('project:')).toEqual([]);
 });
 it('unblocks actual API initialization and gives recovered copies no inherited foreign access',async()=>{
  const {dir,store}=await make(),identity=new IdentityService(store),password='A safe migration owner password';const owner=await identity.setup({name:'Migration owner',email:'owner@example.test',password},'127.0.0.1'),removed=await identity.create({name:'Removed member',email:'removed@example.test',password});
  const canonical=record();canonical.members={[owner.id]:'admin'};await store.write('project:'+canonical.project.id,canonical);await store.write('access:'+canonical.project.id,{members:{[owner.id]:'admin'}});const access=await readFile(store.filename('access:'+canonical.project.id),'utf8'),ciphertext=await readFile(store.filename('project:'+canonical.project.id),'utf8');
  const legacy=structuredClone(canonical);legacy.project.name='Changed in old application';legacy.members={[removed.id]:'admin'};await writeFile(path.join(dir,canonical.project.id+'.json'),JSON.stringify(legacy));
  const server=createApp({dataDir:dir,encryptionKey:Buffer.alloc(32,44),requireIdentity:true}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No listener');const url='http://127.0.0.1:'+address.port;
  try{expect((await fetch(url+'/api/auth/status')).status).toBe(200);const login=async(email:string)=>{const response=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});expect(response.status).toBe(200);return response.headers.get('set-cookie')!.split(';')[0];};
   const cookie=await login('owner@example.test'),listing=await(await fetch(url+'/api/projects',{headers:{Cookie:cookie}})).json();expect(listing.projects).toHaveLength(2);const recovered=listing.projects.find((project:{id:string})=>project.id!==canonical.project.id);expect(listing.permissions[recovered.id]).toBe('admin');
   const removedCookie=await login('removed@example.test'),hidden=await(await fetch(url+'/api/projects',{headers:{Cookie:removedCookie}})).json();expect(hidden.projects).toEqual([]);expect((await fetch(url+'/api/projects/'+recovered.id,{headers:{Cookie:removedCookie}})).status).toBe(404);
   expect(await readFile(store.filename('access:'+canonical.project.id),'utf8')).toBe(access);expect(await readFile(store.filename('project:'+canonical.project.id),'utf8')).toBe(ciphertext);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
});
