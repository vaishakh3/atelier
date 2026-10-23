import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

const magic=Buffer.from('ATELIER_LEGACY_V1\n'),maximum=128*1024*1024;
interface ArchivedFile {path:string;bytes:Buffer}
interface Payload {format:'atelier-legacy-localstorage';version:1;files:{path:string;sha256:string;data:string}[]}
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const safeRelative=(name:string)=>name.length>0&&!name.includes('\\')&&!name.includes('\0')&&!path.posix.isAbsolute(name)&&name.split('/').every(part=>part!=='.'&&part!=='..'&&part.length>0);
async function snapshot(profile:string):Promise<ArchivedFile[]|null>{
 const source=path.join(profile,'Partitions','atelier-workspace','Local Storage');
 // Every existing ancestor belongs to this profile. Never follow a legacy symlink.
 for(const filename of [profile,path.join(profile,'Partitions'),path.join(profile,'Partitions','atelier-workspace'),source]){
  try{const info=await lstat(filename);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Unsupported legacy storage path.');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 }
 const root=await realpath(source),files:ArchivedFile[]=[];let total=0;
 async function visit(directory:string,relative:string,depth:number){
  if(depth>8)throw new Error('Legacy storage exceeds the supported directory depth.');
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=relative?`${relative}/${entry.name}`:entry.name,filename=path.join(directory,entry.name);
   if(!safeRelative(name)||entry.isSymbolicLink())throw new Error('Legacy storage contains an unsupported path.');
   if(entry.isDirectory()){await visit(filename,name,depth+1);continue;}
   if(!entry.isFile()||files.length>=4096)throw new Error('Legacy storage contains an unsupported entry.');
   const actual=await realpath(filename);if(!actual.startsWith(`${root}${path.sep}`))throw new Error('Legacy storage contains a foreign path.');
   const handle=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
   try{const info=await handle.stat();if(!info.isFile()||total+info.size>maximum)throw new Error('Legacy storage exceeds the 128 MB preservation limit.');const bytes=await handle.readFile();total+=bytes.length;if(total>maximum)throw new Error('Legacy storage exceeds the 128 MB preservation limit.');files.push({path:name,bytes});}finally{await handle.close();}
  }
 }
 await visit(source,'',0);return files;
}
/** Decrypts into memory only, for verified preservation and an explicit future recovery tool. */
export function decryptLegacyArchive(archive:Buffer,key:Buffer):ArchivedFile[]{
 if(key.length!==32||archive.length>maximum||archive.length<magic.length+28||!archive.subarray(0,magic.length).equals(magic))throw new Error('Invalid encrypted legacy archive.');
 try{
  const offset=magic.length,decipher=createDecipheriv('aes-256-gcm',key,archive.subarray(offset,offset+12));decipher.setAAD(magic);decipher.setAuthTag(archive.subarray(offset+12,offset+28));
  const payload=JSON.parse(Buffer.concat([decipher.update(archive.subarray(offset+28)),decipher.final()]).toString('utf8')) as Payload;
  if(payload.format!=='atelier-legacy-localstorage'||payload.version!==1||!Array.isArray(payload.files)||payload.files.length>4096)throw new Error();
  const names=new Set<string>();let total=0;
  return payload.files.map(file=>{if(!file||typeof file.path!=='string'||!safeRelative(file.path)||names.has(file.path)||typeof file.data!=='string'||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)||!/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(file.data))throw new Error();const bytes=Buffer.from(file.data,'base64');if(digest(bytes)!==file.sha256||((total+=bytes.length)>maximum))throw new Error();names.add(file.path);return{path:file.path,bytes};});
 }catch{throw new Error('The encrypted legacy archive could not be verified.');}
}
/** Archive, fsync, decrypt/compare, recheck the source, then clear only the old localStorage. */
export async function preserveLegacyLocalStorage(profile:string,key:Buffer,clearLegacy:()=>Promise<void>):Promise<{archivePath:string;fileCount:number}|null>{
 if(!path.isAbsolute(profile)||key.length!==32)throw new Error('Invalid legacy storage preservation configuration.');
 const files=await snapshot(profile);if(files===null)return null;
 const payload:Payload={format:'atelier-legacy-localstorage',version:1,files:files.map(file=>({path:file.path,sha256:digest(file.bytes),data:file.bytes.toString('base64')}))};
 const plain=Buffer.from(JSON.stringify(payload)),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);
 const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]),archive=Buffer.concat([magic,iv,cipher.getAuthTag(),ciphertext]);plain.fill(0);
 if(archive.length>maximum)throw new Error('Legacy storage exceeds the 128 MB encrypted preservation limit.');
 const directory=path.join(profile,'secure','legacy-recovery');await mkdir(directory,{recursive:true,mode:0o700});
 const filename=path.join(directory,`localstorage-${Date.now()}-${randomBytes(6).toString('hex')}.atelier-legacy`),temporary=`${filename}.tmp`,handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(archive);await handle.sync();}catch(error){await unlink(temporary).catch(()=>{});throw error;}finally{await handle.close();}
 await rename(temporary,filename);
 if(process.platform!=='win32'){const directoryHandle=await open(directory,'r');try{await directoryHandle.sync();}catch(error){if(!['EINVAL','ENOTSUP','EBADF'].includes((error as NodeJS.ErrnoException).code||''))throw error;}finally{await directoryHandle.close();}}
 const recovered=decryptLegacyArchive(await readFile(filename),key),current=await snapshot(profile);
 const equal=(values:ArchivedFile[]|null)=>values?.length===files.length&&files.every((file,index)=>values[index].path===file.path&&values[index].bytes.equals(file.bytes));
 if(!equal(recovered)||!equal(current))throw new Error('Legacy storage changed while it was being preserved. The original cache was not cleared.');
 await clearLegacy();
 // Chromium may retain deleted LevelDB values after a logical clear. Remove the now-archived store.
 await rm(path.join(profile,'Partitions','atelier-workspace','Local Storage'),{recursive:true,force:true});
 return{archivePath:filename,fileCount:files.length};
}
