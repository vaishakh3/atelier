import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createHash, createPublicKey } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateThirdPartyNotices, verifyThirdPartyNotices } from './third-party-notices.mjs';
import {selectMacSigning,verifyLocalSignature} from './local-signing.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const args=new Set(process.argv.slice(2)),buildRoot=path.join(root,'work','desktop-build'),stage=path.join(buildRoot,'app');
const option=(name,fallback)=>[...args].find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const targetPlatform=option('platform',process.platform),targetArch=option('arch',process.arch);
if(!['darwin','win32','linux'].includes(targetPlatform)||!['arm64','x64'].includes(targetArch))throw new Error('Supported desktop targets are darwin/win32/linux and arm64/x64.');
if(args.has('--run')&&(targetPlatform!==process.platform||targetArch!==process.arch))throw new Error('Development launch must match the current host platform and architecture.');
const metadata=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const electronMetadata=JSON.parse(await readFile(path.join(root,'node_modules','electron','package.json'),'utf8'));
function run(command,arguments_,options={}){
 return new Promise((resolve,reject)=>{const child=spawn(command,arguments_,{cwd:root,stdio:'inherit',...options});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`${path.basename(command)} exited ${code??signal}`)));});
}
async function officialElectronZip(){
 const filename=`electron-v${electronMetadata.version}-${targetPlatform}-${targetArch}.zip`,archive=path.join(buildRoot,filename);
 const checksums=JSON.parse(await readFile(path.join(root,'node_modules','electron','checksums.json'),'utf8')),expected=checksums[filename];
 if(typeof expected!=='string'||!/^[a-f0-9]{64}$/i.test(expected))throw new Error('The installed Electron package has no trusted runtime checksum.');
 async function verified(){if(!existsSync(archive))return false;const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);return hash.digest('hex')===expected;}
 if(!await verified()){
  const urls=[`https://github.com/electron/electron/releases/download/v${electronMetadata.version}/${filename}?download=1&cachebust=${Date.now()}`,`https://npmmirror.com/mirrors/electron/${electronMetadata.version}/${filename}`];
  let transferred=false;
  for(const url of urls){try{await run(process.platform==='win32'?'curl.exe':'curl',['--silent','--show-error','--fail','--location','--http1.1','--continue-at','-','--connect-timeout','15','--max-time','600','--speed-time','30','--speed-limit','1024','--output',archive,url]);transferred=true;break;}catch{/* Preserve partial bytes for an authenticated range resume. */}}
  if(!transferred)throw new Error('The Electron runtime could not be downloaded from the official release or verified mirror.');
  if(!await verified()){await rm(archive,{force:true});throw new Error('The official Electron runtime failed SHA256 verification.');}
 }
 return archive;
}
async function developmentElectron(){
 if(process.platform!=='darwin'||process.arch!=='arm64')return require('electron');
 const executable=path.join(root,'node_modules','electron','dist','Electron.app','Contents','MacOS','Electron');
 if(!existsSync(executable)){
  const archive=await officialElectronZip(),dist=path.join(root,'node_modules','electron','dist');await mkdir(dist,{recursive:true});
  await run('/usr/bin/ditto',['-x','-k',archive,dist]);
  await writeFile(path.join(root,'node_modules','electron','path.txt'),'Electron.app/Contents/MacOS/Electron');
 }
 return executable;
}
if(args.has('--run')&&args.has('--package'))throw new Error('Choose --run or --package.');
await mkdir(buildRoot,{recursive:true});
if(!args.has('--skip-frontend'))await run(process.execPath,[path.join(root,'node_modules','vite','bin','vite.js'),'build']);
await rm(stage,{recursive:true,force:true});await mkdir(path.join(stage,'desktop-runtime'),{recursive:true});
await Promise.all([
 build({entryPoints:[path.join(root,'desktop','main.ts')],outfile:path.join(stage,'desktop-runtime','main.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],sourcemap:false,logLevel:'info'}),
 build({entryPoints:[path.join(root,'desktop','preload.ts')],outfile:path.join(stage,'desktop-runtime','preload.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],sourcemap:false,logLevel:'info'})
]);
await cp(path.join(root,'dist'),path.join(stage,'dist'),{recursive:true});
await generateThirdPartyNotices(root,stage);const notices=await verifyThirdPartyNotices(stage);console.log(`Preserved runtime notices for ${notices.packages} packages (${notices.files} original files).`);
await writeFile(path.join(stage,'package.json'),JSON.stringify({name:'atelier-desktop',productName:'Atelier',version:metadata.version,private:true,main:'desktop-runtime/main.cjs',description:'Standalone BIM copilot for architects and planners',author:'Atelier'},null,2));
// Published packages never contain credentials or development-workspace paths.
const updateConfiguration=process.env.ATELIER_UPDATE_FEED_URL&&process.env.ATELIER_UPDATE_PUBLIC_KEY&&process.env.APPLE_TEAM_ID?{feedUrl:process.env.ATELIER_UPDATE_FEED_URL,publicKey:process.env.ATELIER_UPDATE_PUBLIC_KEY,teamId:process.env.APPLE_TEAM_ID,downloadOrigins:JSON.parse(process.env.ATELIER_UPDATE_DOWNLOAD_ORIGINS||'[]')}:null;
if(updateConfiguration){const feed=new URL(updateConfiguration.feedUrl);if(!updateConfiguration.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')||createPublicKey(updateConfiguration.publicKey).asymmetricKeyType!=='ed25519'||feed.protocol!=='https:'||feed.username||feed.password||feed.hash||[...feed.searchParams.keys()].some(key=>/token|secret|password|api.?key/i.test(key)))throw new Error('Updates require a public HTTPS feed and an Ed25519 public key; credentials and private keys must never be packaged.');}
await writeFile(path.join(stage,'desktop-config.json'),JSON.stringify({updates:updateConfiguration},null,2));
const macIdentity=process.env.ATELIER_MAC_SIGN_IDENTITY,windowsCertificate=process.env.WINDOWS_CERTIFICATE_FILE;
const macSigning=args.has('--package')?await selectMacSigning({targetPlatform,productionIdentity:macIdentity,requireLocal:process.env.ATELIER_MAC_LOCAL_SIGNING==='1',entitlements:path.join(root,'desktop','entitlements.plist')}):{signing:'ad-hoc',options:{}};
try{
const signing=targetPlatform==='darwin'?macSigning.signing:targetPlatform==='win32'&&windowsCertificate?'authenticode':'unsigned';
const releaseMetadata={format:1,version:metadata.version,platform:targetPlatform,arch:targetArch,identityRequired:true,storage:'aes-256-gcm/os-protected-key',signing,...(macSigning.identity?{localSigningCertificateSha1:macSigning.identity}:{}),createdAt:new Date().toISOString()};
await writeFile(path.join(stage,'release-metadata.json'),JSON.stringify(releaseMetadata,null,2));
if(process.platform==='darwin'&&existsSync('/usr/bin/swift')){
 await run('/usr/bin/swift',[path.join(root,'desktop','create-icon.swift'),path.join(buildRoot,'Atelier.iconset')]);
 await run('/usr/bin/iconutil',['-c','icns',path.join(buildRoot,'Atelier.iconset'),'-o',path.join(stage,'desktop-runtime','atelier.icns')]);
 await cp(path.join(buildRoot,'Atelier.iconset','icon_512x512@2x.png'),path.join(stage,'desktop-runtime','icon.png'));
}
const allowed=new Set(['desktop-runtime','dist','package.json','desktop-config.json','release-metadata.json','THIRD_PARTY_NOTICES.txt','third-party-licenses.json','third-party-licenses']);
if((await readdir(stage)).some(name=>!allowed.has(name)))throw new Error('Unexpected desktop bundle content.');
console.log(`Desktop runtime prepared at ${stage}. No credential files were copied.`);
if(args.has('--package')){
 const {packager}=await import('@electron/packager');
 await officialElectronZip();
 const platformSigning=targetPlatform==='darwin'?{...macSigning.options,...(macIdentity?(process.env.ATELIER_NOTARY_KEYCHAIN_PROFILE?{osxNotarize:{keychainProfile:process.env.ATELIER_NOTARY_KEYCHAIN_PROFILE}}:process.env.APPLE_ID&&process.env.APPLE_APP_SPECIFIC_PASSWORD&&process.env.APPLE_TEAM_ID?{osxNotarize:{appleId:process.env.APPLE_ID,appleIdPassword:process.env.APPLE_APP_SPECIFIC_PASSWORD,teamId:process.env.APPLE_TEAM_ID}}:{}):{})}:targetPlatform==='win32'&&windowsCertificate?{windowsSign:{certificateFile:windowsCertificate,certificatePassword:process.env.WINDOWS_CERTIFICATE_PASSWORD,timestampServer:process.env.WINDOWS_TIMESTAMP_SERVER||'http://timestamp.digicert.com'}}:{};
 const packaged=await packager({dir:stage,out:path.join(buildRoot,'packaged'),overwrite:true,name:'Atelier',executableName:'Atelier',platform:targetPlatform,arch:targetArch,electronVersion:electronMetadata.version,electronZipDir:buildRoot,appVersion:metadata.version,appBundleId:'com.atelier.bim',appCategoryType:'public.app-category.graphics-design',darwinDarkModeSupport:true,asar:true,prune:false,...platformSigning,...(targetPlatform==='darwin'&&existsSync(path.join(stage,'desktop-runtime','atelier.icns'))?{icon:path.join(stage,'desktop-runtime','atelier.icns')}:{})});
 const candidate=targetPlatform==='darwin'?path.join(packaged[0],'Atelier.app'):packaged[0];
 // Packager can warn instead of rejecting a failed signing pass. Verify before
 // replacing the last deliverable, then verify the copied bundle again below.
 if(macSigning.signing==='local-development')await verifyLocalSignature(candidate,macSigning.identity);
 const artifactName=targetPlatform==='darwin'?(targetArch===process.arch&&process.platform==='darwin'?'Atelier.app':`Atelier-${targetPlatform}-${targetArch}.app`):`Atelier-${targetPlatform}-${targetArch}`;
 const destination=path.join(root,'outputs',artifactName);
 await mkdir(path.dirname(destination),{recursive:true});await rm(destination,{recursive:true,force:true});await cp(candidate,destination,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
 if(targetPlatform==='darwin'&&process.platform==='darwin'&&macSigning.signing==='ad-hoc')await run('/usr/bin/codesign',['--force','--deep','--sign','-',destination]);
 if(macSigning.signing==='local-development')await verifyLocalSignature(destination,macSigning.identity);
 await run(process.execPath,[path.join(root,'scripts','verify-desktop-package.mjs'),destination]);
 const archive=path.join(root,'outputs',`Atelier-${metadata.version}-${targetPlatform}-${targetArch}.zip`);await rm(archive,{force:true});
 if(process.platform==='darwin')await run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',destination,archive]);
 else if(process.platform==='win32')await run('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts','archive-release.ps1'),'-Source',destination,'-Destination',archive]);
 else await run('zip',['-qry',archive,path.basename(destination)],{cwd:path.dirname(destination)});
 const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);await writeFile(`${archive}.sha256`,`${hash.digest('hex')}  ${path.basename(archive)}\n`);
 if(targetPlatform===process.platform&&targetArch===process.arch)await cp(archive,path.join(root,'outputs','Atelier-release.zip'));
 console.log(`Built ${targetPlatform}/${targetArch} desktop (${signing}): ${destination}\nRelease archive: ${archive}`);
}
if(args.has('--run')){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 await run(await developmentElectron(),[stage,...(args.has('--smoke-test')?['--smoke-test']:[])],{env});
}
}finally{await macSigning.lock?.();}
