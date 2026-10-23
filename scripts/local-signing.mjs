import {generateKeyPairSync,randomBytes,X509Certificate} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chmod,lstat,mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const NAME='Atelier Local Development Signing';
const CONFIG='identity.json';
const IMPORTED_KEY_LABEL='Imported Private Key';
export const defaultSigningDirectory=()=>path.join(os.homedir(),'Library','Application Support','Atelier Build Signing');
const paths=directory=>({directory,config:path.join(directory,CONFIG),keychain:path.join(directory,'atelier-local-signing.keychain-db'),certificate:path.join(directory,'certificate.pem'),archive:path.join(directory,'identity.p12')});
const exists=async filename=>{try{await lstat(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

/** Never include child arguments, environment or stderr in errors: they can contain passwords. */
export async function privateCommand(command,args,{env=process.env,captureStderr=false}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});let output='',overflow=false;
    const timer=setTimeout(()=>{child.kill('SIGKILL');},60_000);
    child.stdout.on('data',chunk=>{if(output.length+chunk.length>1_048_576){overflow=true;child.kill('SIGKILL');}else output+=chunk.toString();});
    child.stderr.on('data',chunk=>{if(captureStderr){if(output.length+chunk.length>1_048_576){overflow=true;child.kill('SIGKILL');}else output+=chunk.toString();}});
    child.once('error',()=>{clearTimeout(timer);reject(new Error(`Local signing ${path.basename(command)} operation could not start.`));});
    child.once('close',code=>{clearTimeout(timer);if(code===0&&!overflow)resolve(output);else reject(new Error(`Local signing ${path.basename(command)} operation failed. Existing signing material was preserved.`));});
  });
}
async function privatePath(filename,directory=false){
  const info=await lstat(filename);
  if(info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile())||(typeof process.getuid==='function'&&info.uid!==process.getuid())||(info.mode&0o077))throw new Error('Local signing files must be owned by this user and private (directory0700/files0600), with no symbolic links.');
}
export function validateLocalSigningConfig(value){
  const keys=['version','state','certificateSha1','keychainPassword','archivePassword','accessVersion'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||value.version!==1||(value.accessVersion!==undefined&&value.accessVersion!==1)||!['pending','ready'].includes(value.state)||!/^[A-F0-9]{40}$/.test(value.certificateSha1??'')||![value.keychainPassword,value.archivePassword].every(password=>typeof password==='string'&&/^[A-Za-z0-9_-]{40,100}$/.test(password)))throw new Error('The retained local signing configuration is invalid. It was not replaced.');
  return value;
}
async function readConfiguration(directory){
  const files=paths(directory);if(!await exists(files.config)){if(await exists(directory)){await privatePath(directory,true);if(await exists(files.keychain)||await exists(files.certificate)||await exists(files.archive))throw new Error('Incomplete local signing material exists. Restore its original identity configuration; no replacement certificate was generated.');}return null;}
  await privatePath(directory,true);await privatePath(files.config);let config;
  try{config=validateLocalSigningConfig(JSON.parse(await readFile(files.config,'utf8')));}catch{throw new Error('The retained local signing configuration is invalid. It was not replaced.');}
  for(const filename of [files.certificate,files.archive])await privatePath(filename);
  const certificate=new X509Certificate(await readFile(files.certificate));
  if(certificate.fingerprint.replaceAll(':','').toUpperCase()!==config.certificateSha1||!certificate.verify(certificate.publicKey)||!certificate.keyUsage?.includes('1.3.6.1.5.5.7.3.3')||Date.parse(certificate.validTo)<=Date.now())throw new Error('The retained signing certificate is invalid or expired. Restore the original identity before rebuilding.');
  return config;
}
async function writeConfiguration(files,config){const temporary=files.config+'.pending-'+randomBytes(6).toString('hex');await writeFile(temporary,JSON.stringify(config),{mode:0o600,flag:'wx'});try{await rename(temporary,files.config);}catch(error){await rm(temporary,{force:true});throw error;}}

/** Read-only metadata inspection; does not unlock or access any private key. */
export async function inspectLocalSigning(directory=defaultSigningDirectory()){
  const config=await readConfiguration(directory);return config?{configured:true,state:config.state,certificateSha1:config.certificateSha1,keychainPresent:await exists(paths(directory).keychain)}:{configured:false};
}
/** Scoped only to the newly provisioned identity in its dedicated keychain. */
export function localKeyAccessArguments(config,directory){
  return['set-key-partition-list','-S','apple-tool:,apple:','-s','-t','private','-l',IMPORTED_KEY_LABEL,'-k',config.keychainPassword,paths(directory).keychain];
}
/** Explicit first-time setup/resume only. Never invoked automatically by a build. */
export async function provisionLocalSigning({directory=defaultSigningDirectory(),runCommand=privateCommand}={}){
  if(process.platform!=='darwin')throw new Error('Local signing provisioning requires macOS.');
  directory=path.resolve(directory);const files=paths(directory);let config=await readConfiguration(directory);
  const reused=Boolean(config);
  if(!config){
    await mkdir(directory,{recursive:true,mode:0o700});await privatePath(directory,true);
    const temporary=await mkdtemp(path.join(directory,'.provision-'));await chmod(temporary,0o700);
    try{
      const archivePassword=randomBytes(32).toString('base64url'),pemPassword=randomBytes(32).toString('base64url');
      const {privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase:pemPassword}});
      const keyFile=path.join(temporary,'private.pem'),certFile=path.join(temporary,'certificate.pem'),archiveFile=path.join(temporary,'identity.p12'),requestConfig=path.join(temporary,'request.cnf');
      await writeFile(keyFile,privateKey,{mode:0o600,flag:'wx'});
      await writeFile(requestConfig,`[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=${NAME}\n[extensions]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=codeSigning\n`,{mode:0o600,flag:'wx'});
      const env={...process.env,ATELIER_SIGNING_PEM_PASSWORD:pemPassword,ATELIER_SIGNING_ARCHIVE_PASSWORD:archivePassword};
      await runCommand('/usr/bin/openssl',['req','-new','-x509','-sha256','-days','3650','-key',keyFile,'-passin','env:ATELIER_SIGNING_PEM_PASSWORD','-config',requestConfig,'-out',certFile],{env});
      await runCommand('/usr/bin/openssl',['pkcs12','-export','-inkey',keyFile,'-in',certFile,'-name',NAME,'-passin','env:ATELIER_SIGNING_PEM_PASSWORD','-passout','env:ATELIER_SIGNING_ARCHIVE_PASSWORD','-out',archiveFile],{env});
      await chmod(certFile,0o600);await chmod(archiveFile,0o600);const certificate=new X509Certificate(await readFile(certFile));
      config={version:1,state:'pending',certificateSha1:certificate.fingerprint.replaceAll(':','').toUpperCase(),keychainPassword:randomBytes(32).toString('base64url'),archivePassword};
      await rename(certFile,files.certificate);await rename(archiveFile,files.archive);await writeConfiguration(files,config);
    }finally{await rm(temporary,{recursive:true,force:true});}
  }
  // Persist pending before every explicit repair, including older ready configurations.
  // A failed key ACL update must never be mistaken for completed provisioning.
  await writeConfiguration(files,{...config,state:'pending',accessVersion:undefined});
  if(!await exists(files.keychain))await runCommand('/usr/bin/security',['create-keychain','-p',config.keychainPassword,files.keychain]);
  await chmod(files.keychain,0o600);await privatePath(files.keychain);
  try{
    await runCommand('/usr/bin/security',['unlock-keychain','-p',config.keychainPassword,files.keychain]);
    await runCommand('/usr/bin/security',['set-keychain-settings','-lut','21600',files.keychain]);
    const identities=await runCommand('/usr/bin/security',['find-identity','-p','codesigning',files.keychain]);
    if(!identities.toUpperCase().includes(config.certificateSha1)){
      await runCommand('/usr/bin/security',['import',files.archive,'-P',config.archivePassword,'-k',files.keychain,'-T','/usr/bin/codesign','-f','pkcs12']);
    }
    // Import uses a private-key label distinct from the certificate common name.
    // Limit this ACL to that signing key in this newly created private keychain.
    await runCommand('/usr/bin/security',['find-key','-t','private','-s','-l',IMPORTED_KEY_LABEL,files.keychain]);
    await runCommand('/usr/bin/security',localKeyAccessArguments(config,directory));
    const verified=await runCommand('/usr/bin/security',['find-identity','-p','codesigning',files.keychain]);
    if(!verified.toUpperCase().includes(config.certificateSha1))throw new Error('The retained signing identity could not be verified. No replacement identity was generated.');
    await writeConfiguration(files,{...config,state:'ready',accessVersion:1});
  }finally{await runCommand('/usr/bin/security',['lock-keychain',files.keychain]).catch(()=>{});}
  return{configured:true,certificateSha1:config.certificateSha1,reused};
}

/** Parse security's quoted, one-path-per-line output before making any change. */
export function parseKeychainSearchList(output){
  if(typeof output!=='string')throw new Error('The user keychain search list could not be safely read.');
  try{return output.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const value=JSON.parse(line);if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw new Error();return value;});}
  catch{throw new Error('The user keychain search list has an unknown format; no replacement list was written.');}
}
/** Temporary additive registration required by macOS identity lookup, even with --keychain. */
export async function registerLocalSigningKeychain(keychain,runCommand=privateCommand){
  const read=async()=>parseKeychainSearchList(await runCommand('/usr/bin/security',['list-keychains','-d','user']));
  const same=entry=>path.resolve(entry)===path.resolve(keychain);
  const original=await read();if(original.some(same))return async()=>{};
  // Re-read immediately before the update and preserve any newly observed entries.
  const latest=await read();if(latest.some(same))return async()=>{};
  const baseline=[...latest,...original.filter(entry=>!latest.includes(entry))];let restoreNeeded=false;
  const restore=async()=>{
    if(!restoreNeeded)return;
    const current=await read(),remaining=current.filter(entry=>!same(entry));
    const preserved=[...remaining,...baseline.filter(entry=>!remaining.includes(entry))];
    if(JSON.stringify(current)!==JSON.stringify(preserved))await runCommand('/usr/bin/security',['list-keychains','-d','user','-s',...preserved]);
    restoreNeeded=false;
  };
  try{
    restoreNeeded=true;await runCommand('/usr/bin/security',['list-keychains','-d','user','-s',...baseline,keychain]);
    const confirmed=await read();if(!confirmed.some(same)||!baseline.every(entry=>confirmed.includes(entry)))throw new Error('The temporary local signing keychain registration could not be verified.');
    return restore;
  }catch(error){await restore().catch(()=>{});throw error;}
}
/** Unlock only the dedicated build keychain. Caller must invoke lock() in finally. */
export async function loadLocalSigning({directory=defaultSigningDirectory(),required=false,runCommand=privateCommand}={}){
  const config=await readConfiguration(directory),files=paths(directory);
  if(!config){if(required)throw new Error('Run node scripts/local-signing.mjs --provision once before requiring persistent local signing.');return null;}
  if(config.state!=='ready'||config.accessVersion!==1||!await exists(files.keychain))throw new Error('Local signing setup is incomplete. Run node scripts/local-signing.mjs --provision to resume with the retained identity.');
  await privatePath(files.keychain);let restore;
  try{await runCommand('/usr/bin/security',['unlock-keychain','-p',config.keychainPassword,files.keychain]);restore=await registerLocalSigningKeychain(files.keychain,runCommand);}
  catch(error){await runCommand('/usr/bin/security',['lock-keychain',files.keychain]).catch(()=>{});throw error;}
  return{identity:config.certificateSha1,keychain:files.keychain,certificate:files.certificate,lock:async()=>{try{await restore();}finally{await runCommand('/usr/bin/security',['lock-keychain',files.keychain]);}}};
}
export function localSigningOptions(signer,entitlements){
  return{identity:signer.identity,keychain:signer.keychain,identityValidation:false,strictVerify:true,preAutoEntitlements:false,preEmbedProvisioningProfile:false,optionsForFile:()=>({hardenedRuntime:false,timestamp:'none',entitlements})};
}
export async function verifyLocalSignature(application,identity,runCommand=privateCommand){
  await runCommand('/usr/bin/codesign',['--verify','--deep','--strict',application]);
  const requirement=await runCommand('/usr/bin/codesign',['--display','--requirements','-',application],{captureStderr:true});
  const designated=requirement.match(/(?:^|\n)designated\s*=>\s*([^\n]+)/)?.[1]?.trim().replace(/H"([A-Fa-f0-9]{40})"/g,(_,hash)=>`H"${hash.toUpperCase()}"`);
  // Only accept the generated conjunction of this bundle identifier and an actual
  // certificate pin. A hash in cdhash, another identifier or an OR is insufficient.
  const pin=`(?:anchor(?:\\s+root)?(?:\\s*=\\s*|\\s+)|certificate\\s+(?:leaf|root|[0-9]+)\\s*=\\s*)H"${identity.toUpperCase()}"`;
  const identifier='identifier\\s+"com\\.atelier\\.bim"';
  const expected=new RegExp(`^(?:${identifier}\\s+and\\s+${pin}|${pin}\\s+and\\s+${identifier})$`);
  if(!/^[A-F0-9]{40}$/i.test(identity)||!designated||!expected.test(designated))throw new Error('The local application signature is not bound to its retained certificate and application identifier.');
}
export async function selectMacSigning({hostPlatform=process.platform,targetPlatform,productionIdentity,requireLocal=false,loadLocal=loadLocalSigning,entitlements}={}){
  if(targetPlatform!=='darwin')return{signing:'unsigned',options:{}};
  if(productionIdentity)return{signing:'developer-id',options:{osxSign:{identity:productionIdentity,optionsForFile:()=>({hardenedRuntime:true,entitlements})}}};
  if(hostPlatform!=='darwin'){if(requireLocal)throw new Error('Persistent local macOS signing requires a macOS build host.');return{signing:'ad-hoc',options:{}};}
  const local=await loadLocal({required:requireLocal});
  if(requireLocal&&!local)throw new Error('Persistent local signing was required, but no retained signer is configured.');
  return local?{signing:'local-development',options:{osxSign:localSigningOptions(local,entitlements)},identity:local.identity,lock:local.lock}:{signing:'ad-hoc',options:{}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const command=process.argv[2];
  const action=command==='--provision'?()=>provisionLocalSigning():command==='--check'?()=>inspectLocalSigning():null;
  if(!action){console.error('Usage: node scripts/local-signing.mjs --provision | --check');process.exitCode=1;}
  else action().then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Local signing setup/check failed. Existing signing identity and encrypted project vault were not replaced. Inspect private file permissions and retry the explicit setup.');process.exitCode=1;});
}
