import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const licenseName=/^(?:licen[cs]es?|notices?|copying|copyright)(?:[._-].*)?$/i;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function generateThirdPartyNotices(root,output){
 const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
 if(!lock.packages)throw new Error('A package-lock with package provenance is required for runtime notices.');
 let supplements={packages:[]};try{supplements=JSON.parse(await readFile(path.join(root,'desktop','licenses','manifest.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const records=[],sections=['ATELIER — THIRD-PARTY SOFTWARE NOTICES','Generated from the exact package-lock runtime dependency versions. Original license and notice files are preserved alongside this document in third-party-licenses/. Electron runtime notices are included separately. Checked-in supplemental license sources record their authoritative URLs and SHA256 hashes; absent upstream copyright information is never invented.'];
 for(const [location,locked]of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b))){
  if(!location.startsWith('node_modules/')||(locked.dev===true&&location!=='node_modules/electron'))continue;
  if(location.includes('..')||path.isAbsolute(location))throw new Error('Invalid dependency location in package-lock.');
  const directory=path.join(root,location);let metadata;
  try{const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Runtime dependency paths must be regular directories.');metadata=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));}catch(error){if(error.code==='ENOENT'&&locked.optional)continue;throw error;}
  if(metadata.version!==locked.version)throw new Error('Installed dependency version differs from package-lock.');
  const name=metadata.name||location.slice(location.lastIndexOf('node_modules/')+13),identifier=`${name.replace(/[^a-zA-Z0-9@._-]/g,'_')}@${locked.version}-${hash(Buffer.from(location)).slice(0,8)}`,files=[];
  async function visit(folder,relative,depth){
   if(depth>9)return;
   for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name==='node_modules'||entry.name==='.git'||entry.isSymbolicLink())continue;
    const source=path.join(folder,entry.name),local=relative?`${relative}/${entry.name}`:entry.name;
    if(entry.isDirectory()){await visit(source,local,depth+1);continue;}
    if(!entry.isFile()||!licenseName.test(entry.name))continue;
    if((await lstat(source)).size>32*1024*1024)throw new Error('A third-party notice exceeds the supported text size.');
    const bytes=await readFile(source),destination=`third-party-licenses/${identifier}/${local}`;
    await mkdir(path.dirname(path.join(output,destination)),{recursive:true});await writeFile(path.join(output,destination),bytes);
    files.push({source:local,path:destination,sha256:hash(bytes),size:bytes.length});
    sections.push(`\n${'-'.repeat(72)}\n${name}@${locked.version} — ${local}\nDeclared license: ${typeof metadata.license==='string'?metadata.license:JSON.stringify(metadata.license||locked.license||'not specified')}\n${bytes.toString('utf8')}`);
   }
  }
  await visit(directory,'',0);
  const supplemental=supplements.packages.find(entry=>entry.name===name&&entry.version===locked.version);
  for(const file of supplemental?.files||[]){
   if(typeof file.path!=='string'||path.isAbsolute(file.path)||file.path.split('/').includes('..'))throw new Error('Invalid supplemental license path.');
   const bytes=await readFile(path.join(root,'desktop','licenses',file.path));if(hash(bytes)!==file.sha256)throw new Error('A checked-in supplemental license differs from its verified source.');
   const destination=`third-party-licenses/${identifier}/supplemental/${file.path}`;await mkdir(path.dirname(path.join(output,destination)),{recursive:true});await writeFile(path.join(output,destination),bytes);
   files.push({source:file.path,path:destination,sourceUrl:file.sourceUrl,purpose:file.purpose,sha256:hash(bytes),size:bytes.length,supplemental:true});
   sections.push(`\n${'-'.repeat(72)}\n${name}@${locked.version} — supplemental ${file.path}\nSource: ${file.sourceUrl}\nProvenance: ${file.purpose}\n${bytes.toString('utf8')}`);
  }
  const record={name,version:locked.version,location,license:metadata.license||locked.license||null,integrity:locked.integrity||null,files};records.push(record);
  if(!files.length)throw new Error(`Runtime dependency ${name}@${locked.version} has no preserved license text. Add verified supplemental source before packaging.`);
 }
 await mkdir(output,{recursive:true});
 const manifest={format:1,lockSha256:hash(await readFile(path.join(root,'package-lock.json'))),packages:records};
 await writeFile(path.join(output,'THIRD_PARTY_NOTICES.txt'),`${sections.join('\n')}\n`);
 await writeFile(path.join(output,'third-party-licenses.json'),JSON.stringify(manifest,null,2));
 return manifest;
}
export async function verifyThirdPartyNotices(output){
 const notice=await readFile(path.join(output,'THIRD_PARTY_NOTICES.txt'),'utf8'),manifest=JSON.parse(await readFile(path.join(output,'third-party-licenses.json'),'utf8'));
 if(manifest.format!==1||!Array.isArray(manifest.packages)||!manifest.packages.length||!notice.startsWith('ATELIER'))throw new Error('Runtime license provenance is missing.');
 for(const dependency of manifest.packages)for(const file of dependency.files){if(typeof file.path!=='string'||!file.path.startsWith('third-party-licenses/')||file.path.split('/').includes('..'))throw new Error('Invalid third-party notice path.');const bytes=await readFile(path.join(output,file.path));if(hash(bytes)!==file.sha256||bytes.length!==file.size)throw new Error('A preserved third-party notice differs from its source.');}
 return{packages:manifest.packages.length,files:manifest.packages.reduce((count,dependency)=>count+dependency.files.length,0)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const option=(name,fallback)=>process.argv.slice(2).find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
 const root=path.resolve(option('root',path.join(path.dirname(fileURLToPath(import.meta.url)),'..'))),output=path.resolve(option('output',path.join(root,'work','third-party-notices')));
 if(!process.argv.includes('--verify'))await generateThirdPartyNotices(root,output);
 const result=await verifyThirdPartyNotices(output);console.log(`Runtime third-party notice verification passed: ${result.packages} packages, ${result.files} original notice files.`);
}
