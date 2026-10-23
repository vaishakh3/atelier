import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export interface SecureStorageAdapter {
  available():Promise<boolean>;
  encrypt(value:string):Promise<Buffer>;
  decrypt(value:Buffer):Promise<{result:string;shouldReEncrypt:boolean}>;
}
interface ProtectedEnvelope {version:1;protection:'os-keychain';ciphertext:string}
export interface Credential {apiKey:string;model:string}
export const defaultModel='gpt-4.1-mini';
export function validateModel(value:unknown):string {
  if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,120}$/.test(value))throw new Error('Choose a valid model identifier.');
  return value;
}
export function validateApiKey(value:unknown):string {
  if(typeof value!=='string'||!/^sk-[a-zA-Z0-9_-]{17,1021}$/.test(value.trim()))throw new Error('Enter a valid OpenAI API key.');
  return value.trim();
}
async function atomicPrivateFile(filename:string,value:string){
  await mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const temporary=`${filename}.${randomBytes(8).toString('hex')}.tmp`,handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}
  try{await rename(temporary,filename);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
export async function writePrivatePreferences(filename:string,value:Record<string,unknown>){await atomicPrivateFile(filename,JSON.stringify(value));}
async function protect(filename:string,value:string,adapter:SecureStorageAdapter){
  if(!await adapter.available())throw new Error('The operating system secure credential store is unavailable. Unlock it before using Atelier.');
  const cipher=await adapter.encrypt(value);
  const envelope:ProtectedEnvelope={version:1,protection:'os-keychain',ciphertext:cipher.toString('base64')};
  await atomicPrivateFile(filename,JSON.stringify(envelope));
}
async function unprotect(filename:string,adapter:SecureStorageAdapter):Promise<string|null>{
  if(!await adapter.available())throw new Error('The operating system secure credential store is unavailable. Unlock it before using Atelier.');
  let raw:string;try{raw=await readFile(filename,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('The protected credential file cannot be read.');}
  try{
    const value=JSON.parse(raw) as ProtectedEnvelope;
    if(value.version!==1||value.protection!=='os-keychain'||typeof value.ciphertext!=='string'||value.ciphertext.length>20000||!value.ciphertext.length||!/^[a-zA-Z0-9+/]+={0,2}$/.test(value.ciphertext))throw new Error('Invalid envelope');
    const decrypted=await adapter.decrypt(Buffer.from(value.ciphertext,'base64'));
    if(decrypted.shouldReEncrypt)await protect(filename,decrypted.result,adapter);
    return decrypted.result;
  }catch{throw new Error('The operating system could not unlock the protected credential. Existing project data has not been replaced.');}
}
export async function getOrCreateDataKey(directory:string,adapter:SecureStorageAdapter):Promise<Buffer>{
  const filename=path.join(directory,'data-key.protected.json'),existing=await unprotect(filename,adapter);
  if(existing!==null){const key=Buffer.from(existing,'base64');if(key.length!==32||key.toString('base64')!==existing)throw new Error('The protected project encryption key is invalid.');return key;}
  const key=randomBytes(32);await protect(filename,key.toString('base64'),adapter);return key;
}
/** Existing encrypted records are never orphaned by silently generating a replacement vault key. */
export async function getProfileDataKey(profile:string,adapter:SecureStorageAdapter):Promise<Buffer>{
  const directory=path.join(profile,'secure'),filename=path.join(directory,'data-key.protected.json');
  let hasKey=false;
  try{const info=await lstat(filename);if(!info.isFile()||info.isSymbolicLink())throw new Error('The protected project encryption key is not a regular file.');hasKey=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!hasKey){
    for(const folder of [path.join(profile,'projects'),path.join(profile,'projects','.backups'),path.join(directory,'legacy-recovery')]){
      let entries;try{const info=await lstat(folder);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('The encrypted project data directory is invalid.');entries=await readdir(folder,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
      if(entries.some(entry=>/\.atelier(?:$|\..+\.(?:bak|tmp)$)|\.atelier-legacy(?:$|\.tmp$)/.test(entry.name)))throw new Error('The protected project encryption key is missing while encrypted data exists. Restore the original OS-protected key or a portable backup; no replacement key was created.');
    }
  }
  return getOrCreateDataKey(directory,adapter);
}
export async function loadApiCredential(directory:string,adapter:SecureStorageAdapter):Promise<Credential|null>{
  const value=await unprotect(path.join(directory,'openai.protected.json'),adapter);if(value===null)return null;
  try{const credential=JSON.parse(value);return{apiKey:validateApiKey(credential.apiKey),model:validateModel(credential.model)};}catch{throw new Error('The stored OpenAI credential is invalid. Configure a replacement key in Settings.');}
}
export async function saveApiCredential(directory:string,input:Credential,adapter:SecureStorageAdapter):Promise<void>{
  const credential={apiKey:validateApiKey(input.apiKey),model:validateModel(input.model)};
  await protect(path.join(directory,'openai.protected.json'),JSON.stringify(credential),adapter);
}
export async function removeApiCredential(directory:string){await unlink(path.join(directory,'openai.protected.json')).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('The saved OpenAI credential could not be removed.');});}
