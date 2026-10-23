import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import { createDiagnosticLogger, redactDiagnostic } from '../desktop/diagnostics';
import { getOrCreateDataKey, getProfileDataKey, loadApiCredential, removeApiCredential, saveApiCredential, validateApiKey, validateModel } from '../desktop/secure-store';
import type { SecureStorageAdapter } from '../desktop/secure-store';
import { validateUpdateConfig, verifySignedUpdateFeed } from '../desktop/updates';
import { assertWorkspaceAdministrator } from '../desktop/authorization';
import { decryptLegacyArchive, preserveLegacyLocalStorage } from '../desktop/legacy-storage';

const directories:string[]=[];
async function temporary(){const parent=path.join(process.cwd(),'work');await mkdir(parent,{recursive:true});const dir=await mkdtemp(path.join(parent,'desktop-test-'));directories.push(dir);return dir;}
function protectedAdapter():SecureStorageAdapter {
 const key=randomBytes(32);
 return{available:async()=>true,encrypt:async value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},decrypt:async value=>{const cipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));cipher.setAuthTag(value.subarray(12,28));return{result:Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString('utf8'),shouldReEncrypt:false};}};
}
afterEach(async()=>{await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
describe('desktop protected storage and diagnostics',()=>{
 it('persists only an OS-protected random data key and returns the same key after restart',async()=>{
  const directory=await temporary(),adapter=protectedAdapter(),key=await getOrCreateDataKey(directory,adapter);
  expect(key).toHaveLength(32);expect((await getOrCreateDataKey(directory,adapter)).equals(key)).toBe(true);
  const text=await readFile(path.join(directory,'data-key.protected.json'),'utf8');expect(text).not.toContain(key.toString('base64'));expect(text).not.toContain(key.toString('hex'));
  if(process.platform!=='win32')expect((await stat(path.join(directory,'data-key.protected.json'))).mode&0o777).toBe(0o600);
 });
 it('fails closed when the OS secure store is unavailable instead of writing plaintext',async()=>{
  const directory=await temporary(),adapter={...protectedAdapter(),available:async()=>false};
  await expect(getOrCreateDataKey(directory,adapter)).rejects.toThrow(/secure credential store is unavailable/);
  await expect(readFile(path.join(directory,'data-key.protected.json'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('does not generate a replacement key when encrypted records, generations, temporary writes or draft archives survive',async()=>{
  for(const name of ['projects/YWNjb3VudHM.atelier','projects/.backups/abc.atelier.123.bak','projects/abc.atelier.123.tmp','secure/legacy-recovery/cache.atelier-legacy']){
   const profile=await temporary(),filename=path.join(profile,name);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,'encrypted marker');
   await expect(getProfileDataKey(profile,protectedAdapter())).rejects.toThrow(/no replacement key was created/);await expect(readFile(path.join(profile,'secure','data-key.protected.json'))).rejects.toMatchObject({code:'ENOENT'});
  }
 });
 it('permits first-time encryption of legacy plaintext and reuses an existing protected profile key',async()=>{
  const profile=await temporary(),adapter=protectedAdapter();await mkdir(path.join(profile,'projects'));await writeFile(path.join(profile,'projects','legacy.json'),'legacy metadata');const key=await getProfileDataKey(profile,adapter);
  await writeFile(path.join(profile,'projects','abc.atelier'),'encrypted marker');expect((await getProfileDataKey(profile,adapter)).equals(key)).toBe(true);
 });
 it('never replaces a corrupted data key and rejects another OS protector',async()=>{
  const directory=await temporary(),adapter=protectedAdapter();await getOrCreateDataKey(directory,adapter);
  const filename=path.join(directory,'data-key.protected.json'),before=await readFile(filename,'utf8');
  await expect(getOrCreateDataKey(directory,protectedAdapter())).rejects.toThrow(/could not unlock/);expect(await readFile(filename,'utf8')).toBe(before);
  await writeFile(filename,'malformed');await expect(getOrCreateDataKey(directory,adapter)).rejects.toThrow(/could not unlock/);expect(await readFile(filename,'utf8')).toBe('malformed');
 });
 it('encrypts only explicitly saved API credentials and removes them on explicit clear',async()=>{
  const directory=await temporary(),adapter=protectedAdapter(),apiKey=`sk-proj-${'a'.repeat(80)}`;
  expect(await loadApiCredential(directory,adapter)).toBeNull();
  await saveApiCredential(directory,{apiKey,model:'gpt-4.1-mini'},adapter);
  expect(await readFile(path.join(directory,'openai.protected.json'),'utf8')).not.toContain(apiKey);
  expect(await loadApiCredential(directory,adapter)).toEqual({apiKey,model:'gpt-4.1-mini'});
  await removeApiCredential(directory);expect(await loadApiCredential(directory,adapter)).toBeNull();
 });
 it('rejects malformed credentials and model identifiers without echoing key material',()=>{
  expect(()=>validateApiKey('plain text')).toThrow(/valid OpenAI API key/);expect(()=>validateModel('model\n<script>')).toThrow(/valid model identifier/);
 });
 it('writes bounded private diagnostics with credentials and personal user paths redacted',async()=>{
  const directory=await temporary(),log=createDiagnosticLogger(directory),secret=`sk-proj-${'b'.repeat(80)}`;
  await log('startup-error',{message:`Authorization: Bearer ${secret}; password=hunter2 at /Users/example/private/file`});
  const output=await readFile(path.join(directory,'desktop.log'),'utf8');expect(output).not.toContain(secret);expect(output).not.toContain('hunter2');expect(output).not.toContain('/Users/example');expect(output).toContain('[REDACTED');
  expect(redactDiagnostic('{"password":"a long password phrase"}')).not.toContain('password phrase');expect(redactDiagnostic('password="two word phrase"')).not.toContain('word phrase');
  expect(redactDiagnostic('x'.repeat(10000)).length).toBeLessThanOrEqual(1600);
 });
});
describe('credential bridge authorization',()=>{
 const origin='http://127.0.0.1:43123',capability='a'.repeat(64),session='b'.repeat(64);
 const respond=(status:unknown,code=200)=>vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(status),{status:code,headers:{'Content-Type':'application/json'}}));
 it('requires a live authenticated workspace administrator from the protected backend',async()=>{
  const request=respond({identityRequired:true,authenticated:true,user:{isAdmin:true}});
  await expect(assertWorkspaceAdministrator(origin,capability,session,request)).resolves.toBeUndefined();
  expect(request).toHaveBeenCalledWith(`${origin}/api/auth/status`,expect.objectContaining({headers:{'X-Atelier-Desktop':capability,Cookie:`atelier_session=${session}`},redirect:'error'}));
 });
 it('rejects signed-out, project-only and stale users instead of trusting renderer role claims',async()=>{
  for(const status of [{identityRequired:true,authenticated:false,user:null},{identityRequired:true,authenticated:true,user:{isAdmin:false,role:'admin'}},{identityRequired:false,authenticated:true,user:{isAdmin:true}},{identityRequired:true,authenticated:true,user:{isAdmin:'true'}}]){
   await expect(assertWorkspaceAdministrator(origin,capability,session,respond(status))).rejects.toThrow(/signed-in workspace administrator/);
  }
  await expect(assertWorkspaceAdministrator(origin,capability,session,respond({},401))).rejects.toThrow(/signed-in workspace administrator/);
 });
 it('fails closed without a valid session and never sends capability credentials off loopback',async()=>{
  const request=respond({identityRequired:true,authenticated:true,user:{isAdmin:true}});
  await expect(assertWorkspaceAdministrator(origin,capability,undefined,request)).rejects.toThrow();
  await expect(assertWorkspaceAdministrator('https://example.com',capability,session,request)).rejects.toThrow();
  await expect(assertWorkspaceAdministrator(`${origin}/unexpected`,capability,session,request)).rejects.toThrow();
  await expect(assertWorkspaceAdministrator(origin,capability,'x\r\nmalformed',request)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
 });
 it('does not leak response bodies or private values when the backend is unavailable',async()=>{
  const request=vi.fn<typeof fetch>(async()=>{throw new Error(`network failure ${session}`);});
  await expect(assertWorkspaceAdministrator(origin,capability,session,request)).rejects.toThrow('A signed-in workspace administrator is required to change AI credentials.');
 });
});
describe('legacy plaintext draft preservation',()=>{
 async function legacy(profile:string){const directory=path.join(profile,'Partitions','atelier-workspace','Local Storage','leveldb');await mkdir(directory,{recursive:true});return directory;}
 it('preserves every legacy byte in a verified private encrypted archive before clearing its old partition',async()=>{
  const profile=await temporary(),directory=await legacy(profile),key=randomBytes(32),bytes=Buffer.from('unsaved private model draft\0\u0001');
  await writeFile(path.join(directory,'000003.log'),bytes);await writeFile(path.join(directory,'CURRENT'),'MANIFEST-000001\n');
  const clear=vi.fn(async()=>{expect(await readFile(path.join(directory,'000003.log'))).toEqual(bytes);const archived=await readdir(path.join(profile,'secure','legacy-recovery'));expect(archived).toHaveLength(1);const recovered=decryptLegacyArchive(await readFile(path.join(profile,'secure','legacy-recovery',archived[0])),key);expect(recovered.find(file=>file.path==='leveldb/000003.log')?.bytes).toEqual(bytes);});
  const result=await preserveLegacyLocalStorage(profile,key,clear);expect(clear).toHaveBeenCalledTimes(1);expect(result?.fileCount).toBe(2);
  const encrypted=await readFile(result!.archivePath);expect(encrypted.includes(bytes)).toBe(false);expect(()=>decryptLegacyArchive(encrypted,randomBytes(32))).toThrow(/verified/);const tampered=Buffer.from(encrypted);tampered[tampered.length-1]^=1;expect(()=>decryptLegacyArchive(tampered,key)).toThrow(/verified/);
  await expect(stat(directory)).rejects.toMatchObject({code:'ENOENT'});if(process.platform!=='win32')expect((await stat(result!.archivePath)).mode&0o777).toBe(0o600);
 });
 it('does not clear an absent store, oversized files or a symbolic link to foreign files',async()=>{
  const profile=await temporary(),key=randomBytes(32),clear=vi.fn(async()=>{});
  expect(await preserveLegacyLocalStorage(profile,key,clear)).toBeNull();
  const directory=await legacy(profile),large=await open(path.join(directory,'large.log'),'w');await large.truncate(129*1024*1024);await large.close();
  await expect(preserveLegacyLocalStorage(profile,key,clear)).rejects.toThrow(/128 MB/);await rm(path.join(directory,'large.log'));
  if(process.platform!=='win32'){await symlink(path.join(profile,'foreign'),path.join(directory,'linked'));await expect(preserveLegacyLocalStorage(profile,key,clear)).rejects.toThrow(/unsupported path/);}
  expect(clear).not.toHaveBeenCalled();
 });
 it('retains both the original cache and its verified archive if Chromium cannot clear the old store',async()=>{
  const profile=await temporary(),directory=await legacy(profile),key=randomBytes(32);await writeFile(path.join(directory,'CURRENT'),'draft bytes');
  await expect(preserveLegacyLocalStorage(profile,key,async()=>{throw new Error('Store locked');})).rejects.toThrow('Store locked');
  expect(await readFile(path.join(directory,'CURRENT'),'utf8')).toBe('draft bytes');const archives=await readdir(path.join(profile,'secure','legacy-recovery'));expect(archives).toHaveLength(1);expect(decryptLegacyArchive(await readFile(path.join(profile,'secure','legacy-recovery',archives[0])),key)[0].bytes.toString()).toBe('draft bytes');
 });
});
describe('release third-party notice preservation',()=>{
 it('uses native nested ASAR paths on Windows and POSIX without accepting absolute or traversal paths',async()=>{
  const module=pathToFileURL(path.join(process.cwd(),'scripts','asar-paths.mjs')).href,run=promisify(execFile);
  const program=`import assert from 'node:assert/strict';import path from 'node:path';import {archiveEntryPath} from ${JSON.stringify(module)};const entry='third-party-licenses/@babel_runtime@7.29.10-b0d8c4c3/LICENSE';assert.equal(archiveEntryPath(entry,path.win32),path.win32.join('third-party-licenses','@babel_runtime@7.29.10-b0d8c4c3','LICENSE'));assert.equal(archiveEntryPath(entry,path.posix),entry);for(const invalid of ['/absolute','C:\\\\absolute','third-party-licenses/../secret','relative//empty'])assert.throws(()=>archiveEntryPath(invalid,path.win32));`;
  await expect(run(process.execPath,['--input-type=module','--eval',program])).resolves.toMatchObject({stderr:''});
 });
 it('preserves exact runtime LICENSE and NOTICE bytes, includes Electron, and detects modified output',async()=>{
  const root=await temporary(),output=path.join(root,'release'),copyright='Copyright Example Author\r\nMIT license body\n',notice='Retain this original notice.\n';
  const packages={'node_modules/example':{version:'1.2.3',license:'MIT'},'node_modules/electron':{version:'45.0.0',dev:true,license:'MIT'},'node_modules/build-only':{version:'1.0.0',dev:true}};
  await writeFile(path.join(root,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages}));
  for(const[location,metadata]of Object.entries(packages)){await mkdir(path.join(root,location),{recursive:true});await writeFile(path.join(root,location,'package.json'),JSON.stringify({name:location.slice(13),...metadata}));await writeFile(path.join(root,location,'LICENSE'),copyright);}
  await writeFile(path.join(root,'node_modules','example','NOTICE.txt'),notice);
  const script=path.join(process.cwd(),'scripts','third-party-notices.mjs'),run=promisify(execFile);
  await run(process.execPath,[script,`--root=${root}`,`--output=${output}`]);
  const manifest=JSON.parse(await readFile(path.join(output,'third-party-licenses.json'),'utf8'));expect(manifest.packages.map((entry:{name:string})=>entry.name)).toEqual(['electron','example']);
  const example=manifest.packages.find((entry:{name:string})=>entry.name==='example');expect(example.files).toHaveLength(2);
  for(const file of example.files)expect(await readFile(path.join(output,file.path),'utf8')).toBe(file.source==='NOTICE.txt'?notice:copyright);
  expect(await readFile(path.join(output,'THIRD_PARTY_NOTICES.txt'),'utf8')).toContain(notice);
  await writeFile(path.join(output,example.files[0].path),'tampered text');await expect(run(process.execPath,[script,'--verify',`--root=${root}`,`--output=${output}`])).rejects.toMatchObject({code:1});
 });
});
describe('trusted desktop updates',()=>{
 const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString();
 const configuration=validateUpdateConfig({feedUrl:'https://updates.example.com/atelier.json',publicKey,teamId:'ABCDEF1234'})!;
 const payload=(url='https://updates.example.com/Atelier.zip')=>JSON.stringify({currentRelease:'1.2.3',releases:[{version:'1.2.3',updateTo:{url,sha256:'a'.repeat(64),size:12345}}]});
 const signed=(body:string)=>sign(null,Buffer.from(body),pair.privateKey).toString('base64');
 it('disables absent, HTTP, credential-bearing and private-key configurations',()=>{
  expect(validateUpdateConfig(null)).toBeNull();expect(validateUpdateConfig({...configuration,feedUrl:'http://updates.example.com/feed'})).toBeNull();expect(validateUpdateConfig({...configuration,feedUrl:'https://name:secret@updates.example.com/feed'})).toBeNull();expect(validateUpdateConfig({...configuration,publicKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString()})).toBeNull();
 });
 it('accepts a pinned signed feed with HTTPS, origin and integrity checks',()=>{
  const body=payload();expect(()=>verifySignedUpdateFeed(body,signed(body),configuration)).not.toThrow();
 });
 it('rejects a modified feed and untrusted download URL even when publisher signed',()=>{
  const body=payload();expect(()=>verifySignedUpdateFeed(body+' ',signed(body),configuration)).toThrow(/authenticity/);
  const foreign=payload('https://unknown.example.com/update.zip');expect(()=>verifySignedUpdateFeed(foreign,signed(foreign),configuration)).toThrow(/not trusted/);
  const insecure=payload('http://updates.example.com/update.zip');expect(()=>verifySignedUpdateFeed(insecure,signed(insecure),configuration)).toThrow(/not trusted/);
 });
});
