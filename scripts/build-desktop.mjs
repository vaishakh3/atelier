import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const args=new Set(process.argv.slice(2)),buildRoot=path.join(root,'work','desktop-build'),stage=path.join(buildRoot,'app');
const metadata=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const electronMetadata=JSON.parse(await readFile(path.join(root,'node_modules','electron','package.json'),'utf8'));
function run(command,arguments_,options={}){
 return new Promise((resolve,reject)=>{const child=spawn(command,arguments_,{cwd:root,stdio:'inherit',...options});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`${path.basename(command)} exited ${code??signal}`)));});
}
async function officialElectronZip(){
 const filename=`electron-v${electronMetadata.version}-darwin-arm64.zip`,archive=path.join(buildRoot,filename);
 const checksums=JSON.parse(await readFile(path.join(root,'node_modules','electron','checksums.json'),'utf8')),expected=checksums[filename];
 if(typeof expected!=='string'||!/^[a-f0-9]{64}$/i.test(expected))throw new Error('The installed Electron package has no trusted runtime checksum.');
 async function verified(){if(!existsSync(archive))return false;const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);return hash.digest('hex')===expected;}
 if(!await verified()){
  const urls=[`https://github.com/electron/electron/releases/download/v${electronMetadata.version}/${filename}?download=1&cachebust=${Date.now()}`,`https://npmmirror.com/mirrors/electron/${electronMetadata.version}/${filename}`];
  let transferred=false;
  for(const url of urls){try{await run('/usr/bin/curl',['--silent','--show-error','--fail','--location','--http1.1','--continue-at','-','--connect-timeout','15','--max-time','600','--speed-time','30','--speed-limit','1024','--output',archive,url]);transferred=true;break;}catch{/* Preserve partial bytes for an authenticated range resume. */}}
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
await writeFile(path.join(stage,'package.json'),JSON.stringify({name:'atelier-desktop',productName:'Atelier',version:metadata.version,private:true,main:'desktop-runtime/main.cjs',description:'Standalone BIM copilot for architects and planners',author:'Atelier'},null,2));
// Only a destination pointer is packaged. The credential remains in the approved workspace file.
await writeFile(path.join(stage,'desktop-config.json'),JSON.stringify({envPath:path.join(root,'.env.local'),legacyDataDir:path.join(root,'server','data')},null,2));
if(process.platform==='darwin'&&existsSync('/usr/bin/swift')){
 await run('/usr/bin/swift',[path.join(root,'desktop','create-icon.swift'),path.join(buildRoot,'Atelier.iconset')]);
 await run('/usr/bin/iconutil',['-c','icns',path.join(buildRoot,'Atelier.iconset'),'-o',path.join(stage,'desktop-runtime','atelier.icns')]);
 await cp(path.join(buildRoot,'Atelier.iconset','icon_512x512@2x.png'),path.join(stage,'desktop-runtime','icon.png'));
}
const allowed=new Set(['desktop-runtime','dist','package.json','desktop-config.json']);
if((await readdir(stage)).some(name=>!allowed.has(name)))throw new Error('Unexpected desktop bundle content.');
console.log(`Desktop runtime prepared at ${stage}. No credential files were copied.`);
if(args.has('--package')){
 const {packager}=await import('@electron/packager');
 await officialElectronZip();
 const packaged=await packager({dir:stage,out:path.join(buildRoot,'packaged'),overwrite:true,name:'Atelier',executableName:'Atelier',platform:'darwin',arch:'arm64',electronVersion:electronMetadata.version,electronZipDir:buildRoot,appVersion:metadata.version,appBundleId:'com.atelier.bim',appCategoryType:'public.app-category.graphics-design',darwinDarkModeSupport:true,asar:true,prune:false,...(existsSync(path.join(stage,'desktop-runtime','atelier.icns'))?{icon:path.join(stage,'desktop-runtime','atelier.icns')}:{})});
 const candidate=path.join(packaged[0],'Atelier.app'),destination=path.join(root,'outputs','Atelier.app');
 await mkdir(path.dirname(destination),{recursive:true});await rm(destination,{recursive:true,force:true});await cp(candidate,destination,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
 if(process.platform==='darwin')await run('/usr/bin/codesign',['--force','--deep','--sign','-',destination]);
 console.log(`Built standalone macOS arm64 application: ${destination}`);
}
if(args.has('--run')){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 await run(await developmentElectron(),[stage,...(args.has('--smoke-test')?['--smoke-test']:[])],{env});
}
