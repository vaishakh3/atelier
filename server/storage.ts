import {createCipheriv,createDecipheriv,createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {copyFile,mkdir,open,readFile,readdir,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {ApiError} from './errors';

const MAX_RECORD_BYTES=128*1024*1024;
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
    await mkdir(this.directory,{recursive:true,mode:0o700});
    for(const filename of(await readdir(this.directory)).filter(name=>/^[\w-]+\.json$/.test(name))){const file=path.join(this.directory,filename);
      try{if((await stat(file)).size>MAX_RECORD_BYTES)throw new Error('Legacy record exceeds limit');const parsed=validate(JSON.parse(await readFile(file,'utf8')))as{project:{id:string;version:number}},record=`project:${parsed.project.id}`;if(filename!==`${parsed.project.id}.json`&&filename!==`${safeRecord(record)}.json`)continue;if(path.resolve(file)===path.resolve(this.filename(record)))continue;
        try{const existing=await this.read(record)as{project:unknown};if(JSON.stringify(existing.project)!==JSON.stringify(parsed.project))throw new Error('Conflicting legacy project');}catch(error){if(!(error instanceof ApiError)||error.code!=='NOT_FOUND')throw error;await this.write(record,parsed);}
        await this.read(record,validate);await rm(file);this.event('migrated',record);
      }catch{throw new ApiError(503,'MIGRATION_FAILED','An existing project could not be safely migrated. Original data was kept; repair it before continuing.');}
    }
    if(this.encrypted){
      const folder=path.join(this.directory,'.backups');let oldBackups:string[]=[];try{oldBackups=(await readdir(folder)).filter(name=>/\.json\..+\.bak$/.test(name));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      for(const filename of oldBackups){try{const original=path.join(folder,filename),parsed=validate(JSON.parse(await readFile(original,'utf8')))as{project:{id:string}},record=`project:${parsed.project.id}`,suffix=filename.slice(filename.indexOf('.json.')+6),destination=path.join(folder,`${path.basename(this.filename(record))}.${suffix}`);const encoded=this.encode(record,parsed);this.decode(record,encoded,validate);await atomicWrite(destination,encoded);await rm(original);this.event('migrated',record);}catch{throw new ApiError(503,'MIGRATION_FAILED','A previous plaintext recovery generation could not be safely encrypted. Original data was kept; repair it before continuing.');}}
      for(const record of await this.list('project:'))for(const name of(await this.generations(record)).slice(this.backupLimit))await rm(path.join(folder,name),{force:true});
    }
  }
}

export async function exportPortableBackup(projectId:string,value:unknown,password:string):Promise<PortableBackup>{const salt=randomBytes(16),createdAt=new Date().toISOString(),key=await deriveKey(password,salt);try{return{format:'atelier.backup.v1',projectId,createdAt,salt:salt.toString('base64'),kdfVersion:CURRENT_KDF_VERSION,payload:seal(value,key,`atelier-backup-v1|${projectId}|${createdAt}`)};}finally{key.fill(0);}}
export async function importPortableBackup(value:unknown,password:string):Promise<{projectId:string;value:unknown}>{const backup=value as Partial<PortableBackup>;if(!backup||backup.format!=='atelier.backup.v1'||typeof backup.projectId!=='string'||!/^[\w-]{1,160}$/.test(backup.projectId)||typeof backup.createdAt!=='string'||typeof backup.salt!=='string'||Buffer.from(backup.salt,'base64').length!==16||(backup.kdfVersion!==undefined&&backup.kdfVersion!==1&&backup.kdfVersion!==2))throw new ApiError(400,'INVALID_BACKUP','Invalid backup format');const key=await deriveKey(password,Buffer.from(backup.salt,'base64'),backup.kdfVersion??1);try{return{projectId:backup.projectId,value:unseal(backup.payload,key,`atelier-backup-v1|${backup.projectId}|${backup.createdAt}`)};}catch{throw new ApiError(400,'BACKUP_INTEGRITY','Backup password or integrity verification failed');}finally{key.fill(0);}}
