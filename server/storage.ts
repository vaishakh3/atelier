import {createCipheriv,createDecipheriv,createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {lstat,mkdir,open,readFile,readdir,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {ApiError} from './errors';

const MAX_RECORD_BYTES=128*1024*1024;
const MAX_LEGACY_FILES=512,MAX_LEGACY_IMPORTS=1024;
interface LegacyRecord {project:{id:string;version?:number;name?:string;createdAt?:string;updatedAt?:string;audit?:Record<string,unknown>[];elements?:{id:string}[];[key:string]:unknown};versions?:{id:string;actor?:string;label?:string;project:LegacyRecord['project'];[key:string]:unknown}[];comments?:{id:string;versionId:string;author?:string;authorId?:string;role?:string;[key:string]:unknown}[];members?:Record<string,unknown>;[key:string]:unknown}
interface LegacyImport {format:'atelier.legacy-import.v1';sourceProjectId:string;contentHash:string;recoveredProjectId:string;importedAt:string;complete:boolean}
const stable=(value:unknown):string=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>JSON.stringify(key)+':'+stable(item)).join(',')+'}':JSON.stringify(value)??'null';
const legacyContent=(record:LegacyRecord)=>{const {members:_,...content}=record;return stable(content);};
function recoveredLegacyRecord(source:LegacyRecord,id:string,hash:string,importedAt:string):LegacyRecord {
 const record=structuredClone(source),sourceId=record.project.id;
 const history=(project:LegacyRecord['project'])=>({...project,id,...(project.audit?{audit:project.audit.map(entry=>({...entry,id:`audit-legacy-${digest(hash+'|'+String(entry.id)).slice(0,32)}`,actor:'Imported legacy history',action:`Unverified legacy attribution (${String(entry.actor??'unknown')}): ${String(entry.action??'')}`.slice(0,3000)}))}:{})});
 record.project={...history(record.project),name:`${(record.project.name??'Project').slice(0,2950)} · recovered legacy copy`,createdAt:importedAt,updatedAt:importedAt};
 if(record.project.audit)record.project.audit=[{id:`audit-legacy-recovery-${hash.slice(0,32)}`,actor:'System migration',timestamp:importedAt,action:`Recovered a conflicting legacy copy of ${sourceId}. Original encrypted project and access decisions were retained; imported history is unverified.`,affectedIds:record.project.elements?.map(element=>element.id)??[]},...record.project.audit.slice(0,19999)];
 const versionIds=new Map((record.versions??[]).map(version=>[version.id,`version-legacy-${digest(hash+'|'+version.id).slice(0,32)}`]));
 if(record.versions)record.versions=record.versions.map(version=>({...version,id:versionIds.get(version.id)!,actor:`Imported legacy: ${version.actor??'unknown'}`.slice(0,200),project:history(version.project)}));
 if(record.comments)record.comments=record.comments.map(comment=>{const {authorId:_,role:__,...content}=comment;return{...content,id:`comment-legacy-${digest(hash+'|'+comment.id).slice(0,32)}`,versionId:versionIds.get(comment.versionId)??comment.versionId,author:`Imported legacy: ${comment.author??'unknown'}`.slice(0,200)};});
 record.members={};return record;
}
export type KdfVersion=1|2;
export const CURRENT_KDF_VERSION:KdfVersion=2;
// v1 is read-only compatibility. v2 meets OWASP's scrypt minimum at 32 MiB.
const SCRYPT={N:32768,r:8,p:3,maxmem:64*1024*1024};
export const deriveKey=(password:string,salt:Buffer,version:KdfVersion=CURRENT_KDF_VERSION)=>new Promise<Buffer>((resolve,reject)=>scryptCallback(password,salt,32,{...SCRYPT,p:version===1?1:3},(error,key)=>error?reject(error):resolve(key)));
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
interface EncryptedEnvelope {format:'atelier.aes-gcm.v1';iv:string;tag:string;ciphertext:string;checksum:string}
export interface PortableBackup {format:'atelier.backup.v1';projectId:string;createdAt:string;salt:string;kdfVersion?:KdfVersion;payload:EncryptedEnvelope}
interface StorageEvent {timestamp:string;kind:'recovered'|'corrupt'|'migrated'|'maintenance';recordType:string}
const safeRecord=(key:string)=>{if(!/^[\w:-]{1,500}$/.test(key))throw new ApiError(400,'INVALID_RECORD','Invalid storage record');return Buffer.from(key).toString('base64url');};
function seal(value:unknown,key:Buffer,aad:string):EncryptedEnvelope {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const plaintext=Buffer.from(JSON.stringify(value));
  if(plaintext.length>MAX_RECORD_BYTES)throw new ApiError(507,'STORAGE_LIMIT','This record exceeds the supported storage limit. Export a backup and split the project history.');
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]),tag=cipher.getAuthTag();
  return{format:'atelier.aes-gcm.v1',iv:iv.toString('base64'),tag:tag.toString('base64'),ciphertext:ciphertext.toString('base64'),checksum:digest(Buffer.concat([iv,tag,ciphertext]))};
}
function unseal(envelope:unknown,key:Buffer,aad:string):unknown {
  const e=envelope as Partial<EncryptedEnvelope>;
  if(!e||e.format!=='atelier.aes-gcm.v1'||typeof e.iv!=='string'||typeof e.tag!=='string'||typeof e.ciphertext!=='string'||typeof e.checksum!=='string')throw new Error('Invalid encrypted record');
  const iv=Buffer.from(e.iv,'base64'),tag=Buffer.from(e.tag,'base64'),ciphertext=Buffer.from(e.ciphertext,'base64');
  if(iv.length!==12||tag.length!==16||ciphertext.length>MAX_RECORD_BYTES||e.checksum!==digest(Buffer.concat([iv,tag,ciphertext])))throw new Error('Encrypted record integrity failed');
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8'));
}
async function atomicWrite(filename:string,bytes:string|Buffer){
  await mkdir(path.dirname(filename),{recursive:true,mode:0o700});const temporary=`${filename}.${randomBytes(8).toString('hex')}.tmp`;
  try{const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await rename(temporary,filename);try{const directory=await open(path.dirname(filename),'r');try{await directory.sync();}finally{await directory.close();}}catch{/* Windows may reject opening or syncing directory handles; the required file fsync completed before rename. */}}
  catch(error){await rm(temporary,{force:true}).catch(()=>{});throw error;}
}

/** Authenticated encryption, durable replacement, and capped verified generations. */
export class RecordStore {
  private key:Buffer|null;private queues=new Map<string,Promise<void>>();private events:StorageEvent[]=[];private held=new AsyncLocalStorage<Set<string>>();
  constructor(public readonly directory:string,key?:Uint8Array,private backupLimit=5){if(key&&key.byteLength!==32)throw new Error('Storage encryption requires a 32-byte key');this.key=key?Buffer.from(key):null;}
  get encrypted(){return this.key!==null;}
  filename(record:string){return path.join(this.directory,`${safeRecord(record)}.${this.encrypted?'atelier':'json'}`);}
  private event(kind:StorageEvent['kind'],record:string){this.events.push({timestamp:new Date().toISOString(),kind,recordType:record.split(':')[0]});this.events=this.events.slice(-50);}
  diagnostics(){return{encrypted:this.encrypted,backupGenerations:this.backupLimit,events:this.events.map(e=>({...e}))};}
  async transaction<T>(record:string,action:()=>Promise<T>):Promise<T>{if(this.held.getStore()?.has(record))return action();const previous=this.queues.get(record)??Promise.resolve();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),queued=previous.then(()=>gate);this.queues.set(record,queued);await previous;try{return await this.held.run(new Set([...(this.held.getStore()??[]),record]),action);}finally{release();if(this.queues.get(record)===queued)this.queues.delete(record);}}
  private encode(record:string,value:unknown){return JSON.stringify(this.key?seal(value,this.key,`atelier-record-v1|${record}`):value);}
  private decode<T>(record:string,raw:string,validate:(value:unknown)=>T):T {const json=JSON.parse(raw);return validate(this.key?unseal(json,this.key,`atelier-record-v1|${record}`):json);}
  private async generations(record:string){const prefix=path.basename(this.filename(record))+'.';try{return(await readdir(path.join(this.directory,'.backups'))).filter(name=>name.startsWith(prefix)&&name.endsWith('.bak')).sort().reverse();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error;}}
  async read<T>(record:string,validate:(value:unknown)=>T=(value=>value as T),options:{recover?:boolean}={}):Promise<T>{return this.transaction(record,()=>this.readUnlocked(record,validate,options.recover!==false));}
  private async readUnlocked<T>(record:string,validate:(value:unknown)=>T,recover:boolean):Promise<T>{
    let missing=false;try{const file=this.filename(record);if((await stat(file)).size>MAX_RECORD_BYTES*1.5)throw new Error('Oversized storage record');return this.decode(record,await readFile(file,'utf8'),validate);}
    catch(error){missing=(error as NodeJS.ErrnoException).code==='ENOENT';}
    if(recover)for(const name of await this.generations(record)){try{const raw=await readFile(path.join(this.directory,'.backups',name),'utf8'),value=this.decode(record,raw,validate);await atomicWrite(this.filename(record),raw);this.event('recovered',record);return value;}catch{/* Try the next authenticated generation. */}}
    if(missing&&(await this.generations(record)).length===0)throw new ApiError(404,'NOT_FOUND','Record not found');
    this.event('corrupt',record);throw new ApiError(503,'STORAGE_INTEGRITY','A local record failed its integrity check and no valid recovery generation is available. Restore a verified backup; the record was not overwritten.');
  }
  async write(record:string,value:unknown){return this.transaction(record,()=>this.writeUnlocked(record,value));}
  private async writeUnlocked(record:string,value:unknown){
    const encoded=this.encode(record,value);await mkdir(this.directory,{recursive:true,mode:0o700});const file=this.filename(record);
    try{const raw=await readFile(file,'utf8');this.decode(record,raw,value=>value);const folder=path.join(this.directory,'.backups');await mkdir(folder,{recursive:true,mode:0o700});const name=`${path.basename(file)}.${Date.now().toString().padStart(16,'0')}-${randomBytes(5).toString('hex')}.bak`;await atomicWrite(path.join(folder,name),raw);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    await atomicWrite(file,encoded);try{const generations=await this.generations(record);await Promise.all(generations.slice(this.backupLimit).map(name=>rm(path.join(this.directory,'.backups',name),{force:true})));}catch{this.event('maintenance',record);}
  }
  async remove(record:string){return this.transaction(record,async()=>{await rm(this.filename(record),{force:true});await Promise.all((await this.generations(record)).map(name=>rm(path.join(this.directory,'.backups',name),{force:true})));});}
  async list(prefix=''){await mkdir(this.directory,{recursive:true,mode:0o700});const suffix=this.encrypted?'.atelier':'.json';return(await readdir(this.directory)).filter(name=>name.endsWith(suffix)).flatMap(name=>{try{const record=Buffer.from(name.slice(0,-suffix.length),'base64url').toString('utf8');return record.startsWith(prefix)&&safeRecord(record)===name.slice(0,-suffix.length)?[record]:[];}catch{return[];}});}
  async migrateLegacy(validate:(value:unknown)=>unknown){
    return this.transaction('legacy-migration',async()=>{
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const primaries=(await readdir(this.directory)).filter(name=>/^[\w-]+\.json$/.test(name)).sort();
      let backups:string[]=[];if(this.encrypted)try{backups=(await readdir(path.join(this.directory,'.backups'))).filter(name=>/\.json\..+\.bak$/.test(name)).sort().reverse();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(primaries.length+backups.length>MAX_LEGACY_FILES)throw new ApiError(503,'MIGRATION_FAILED','Legacy migration exceeds the supported 512-file batch. Original data was kept; use a verified offline recovery before continuing.');
      const checked=(value:unknown):LegacyRecord=>{const parsed=validate(value)as LegacyRecord;if(!parsed?.project||typeof parsed.project.id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(parsed.project.id))throw new Error('Invalid legacy project identity');return parsed;};
      const readOptional=async<T>(key:string,parser:(value:unknown)=>T):Promise<T|null>=>{try{return await this.read(key,parser,{recover:false});}catch(error){if(error instanceof ApiError&&error.code==='NOT_FOUND')return null;throw error;}};
      const archive=async(name:string,raw:string)=>{
        const contentHash=digest(raw),key=`legacy-source:${digest(name+'\0'+raw)}`,expected={format:'atelier.legacy-source.v1',sourceName:name,contentHash,content:raw};
        if(!this.encrypted){const file=path.join(this.directory,'.legacy-sources',digest(name+'\0'+raw)+'.json'),bytes=JSON.stringify(expected);try{if(await readFile(file,'utf8')!==bytes)throw new Error('Legacy source archive mismatch');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await atomicWrite(file,bytes);}if(await readFile(file,'utf8')!==bytes)throw new Error('Legacy source archive verification failed');return;}
        const verify=(value:unknown)=>{if(stable(value)!==stable(expected))throw new Error('Legacy source archive verification failed');return value;};
        if(!await readOptional(key,verify))await this.write(key,expected);
        await this.read(key,verify,{recover:false});
      };
      const preserveConflict=async(parsed:LegacyRecord)=>{
        const contentHash=digest(legacyContent(parsed)),id=`project-legacy-${contentHash.slice(0,40)}`,key=`legacy-import:${contentHash}`,record=`project:${id}`;
        await this.transaction(record,async()=>{
          const markerParser=(value:unknown):LegacyImport=>{const marker=value as LegacyImport;if(!marker||marker.format!=='atelier.legacy-import.v1'||marker.sourceProjectId!==parsed.project.id||marker.contentHash!==contentHash||marker.recoveredProjectId!==id||typeof marker.importedAt!=='string'||marker.importedAt.length>100||!Number.isFinite(Date.parse(marker.importedAt))||typeof marker.complete!=='boolean')throw new Error('Legacy import marker verification failed');return marker;};
          let marker=await readOptional(key,markerParser);
          if(!marker){if((await this.list('legacy-import:')).length>=MAX_LEGACY_IMPORTS)throw new Error('Legacy recovery-copy limit exceeded');marker={format:'atelier.legacy-import.v1',sourceProjectId:parsed.project.id,contentHash,recoveredProjectId:id,importedAt:new Date().toISOString(),complete:false};await this.write(key,marker);}
          const recovered=checked(recoveredLegacyRecord(parsed,id,contentHash,marker.importedAt)),existing=await readOptional(record,checked);
          if(!existing)await this.write(record,recovered);
          else if(!marker.complete&&stable(existing)!==stable(recovered))throw new Error('Conflicting legacy recovery identity');
          const verified=await this.read(record,checked,{recover:false});
          if(verified.project.id!==id||!marker.complete&&stable(verified)!==stable(recovered))throw new Error('Legacy recovery verification failed');
          if(!marker.complete)await this.write(key,{...marker,complete:true});
          await this.read(key,value=>{if(!markerParser(value).complete)throw new Error('Legacy recovery is incomplete');return value;},{recover:false});
        });
      };
      const migrate=async(name:string,backup:boolean)=>{
        const file=path.join(this.directory,name);
        try{
          // The explicitly unencrypted development store also contains encoded metadata
          // records. They are not legacy projects. Production never skips plaintext records.
          if(!backup&&!this.encrypted){const stem=name.slice(0,-5);try{const decoded=Buffer.from(stem,'base64url').toString('utf8');if(safeRecord(decoded)===stem&&!decoded.startsWith('project:'))return;}catch{/* A literal legacy project filename is checked below. */}}
          const info=await lstat(file);if(!info.isFile()||info.size>MAX_RECORD_BYTES)throw new Error('Invalid or oversized legacy source');
          const raw=await readFile(file,'utf8'),parsed=checked(JSON.parse(raw)),record=`project:${parsed.project.id}`;
          if(!backup&&name!==`${parsed.project.id}.json`&&name!==`${safeRecord(record)}.json`)return;
          if(path.resolve(file)===path.resolve(this.filename(record)))return;
          // Schema defaults and object key order must not invent a data conflict.
          // Never recover or replace existing encrypted canonical bytes from an old plaintext variant.
          const existing=await readOptional(record,checked);
          const protectedIdentity=!existing&&this.encrypted?await readOptional(`access:${parsed.project.id}`,value=>value):null;
          await archive(name,raw);
          if(existing){if(legacyContent(existing)!==legacyContent(parsed))await preserveConflict(parsed);}
          else if(backup||protectedIdentity)await preserveConflict(parsed);
          else{const migrated=structuredClone(parsed);if(Object.prototype.hasOwnProperty.call(migrated,'members'))migrated.members={};await this.write(record,checked(migrated));await this.read(record,checked,{recover:false});}
          const after=await lstat(file);if(!after.isFile()||after.dev!==info.dev||after.ino!==info.ino||await readFile(file,'utf8')!==raw)throw new Error('Legacy source changed during migration');
          await rm(file);this.event('migrated',record);
        }catch{throw new ApiError(503,'MIGRATION_FAILED','An existing legacy project could not be safely preserved. Original data was kept; close older Atelier versions and repair or recover the source before continuing.');}
      };
      for(const name of primaries)await migrate(name,false);
      // Plaintext generations are archived/recovered as distinct copies, never installed as
      // canonical recovery generations that could roll a newer encrypted model backward.
      for(const name of backups)await migrate(path.join('.backups',name),true);
    });
  }
}

export async function exportPortableBackup(projectId:string,value:unknown,password:string):Promise<PortableBackup>{const salt=randomBytes(16),createdAt=new Date().toISOString(),key=await deriveKey(password,salt);try{return{format:'atelier.backup.v1',projectId,createdAt,salt:salt.toString('base64'),kdfVersion:CURRENT_KDF_VERSION,payload:seal(value,key,`atelier-backup-v1|${projectId}|${createdAt}`)};}finally{key.fill(0);}}
export async function importPortableBackup(value:unknown,password:string):Promise<{projectId:string;value:unknown}>{const backup=value as Partial<PortableBackup>;if(!backup||backup.format!=='atelier.backup.v1'||typeof backup.projectId!=='string'||!/^[\w-]{1,160}$/.test(backup.projectId)||typeof backup.createdAt!=='string'||typeof backup.salt!=='string'||Buffer.from(backup.salt,'base64').length!==16||(backup.kdfVersion!==undefined&&backup.kdfVersion!==1&&backup.kdfVersion!==2))throw new ApiError(400,'INVALID_BACKUP','Invalid backup format');const key=await deriveKey(password,Buffer.from(backup.salt,'base64'),backup.kdfVersion??1);try{return{projectId:backup.projectId,value:unseal(backup.payload,key,`atelier-backup-v1|${backup.projectId}|${backup.createdAt}`)};}catch{throw new ApiError(400,'BACKUP_INTEGRITY','Backup password or integrity verification failed');}finally{key.fill(0);}}
