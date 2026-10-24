import { extractFile, listPackage } from '@electron/asar';
import { existsSync,readFileSync,lstatSync,realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { archiveEntryPath } from './asar-paths.mjs';
const directory=path.resolve(process.argv[2]||'');
const archive=directory.endsWith('.app')?path.join(directory,'Contents','Resources','app.asar'):path.join(directory,'resources','app.asar');
if(!existsSync(archive))throw new Error('The packaged application archive is missing.');
const entries=listPackage(archive);
const read=entry=>extractFile(archive,archiveEntryPath(entry));
if(entries.some(name=>/(^|[\\/])(?:\.env(?:\.[^\\/]*)?|server[\\/]data|\.git|node_modules)(?:$|[\\/])/i.test(name)))throw new Error('Development or credential files were included in the application.');
const configuration=JSON.parse(read('desktop-config.json').toString('utf8'));
if(Object.keys(configuration).some(key=>key!=='updates'))throw new Error('The packaged configuration contains a development dependency.');
const metadata=JSON.parse(read('release-metadata.json').toString('utf8'));
if(metadata.identityRequired!==true||metadata.storage!=='aes-256-gcm/os-protected-key')throw new Error('The packaged application does not require protected project storage and identity.');
const runtime=read('desktop-runtime/main.cjs').toString('utf8');
if(/sk-(?:proj|svcacct)-[a-zA-Z0-9_-]{30,}/.test(runtime))throw new Error('A credential-like value was found in the desktop bundle.');
if(!runtime.includes('requireIdentity: true')||!runtime.includes('sandbox: true')||!runtime.includes('contextIsolation: true'))throw new Error('The desktop security configuration is missing.');
const notice=read('THIRD_PARTY_NOTICES.txt').toString('utf8'),licenses=JSON.parse(read('third-party-licenses.json').toString('utf8'));
if(!notice.startsWith('ATELIER')||licenses.format!==1||!Array.isArray(licenses.packages)||!licenses.packages.length)throw new Error('The packaged runtime license notices are missing.');
for(const dependency of licenses.packages)for(const file of dependency.files){if(typeof file.path!=='string'||!file.path.startsWith('third-party-licenses/')||file.path.split('/').includes('..'))throw new Error('Invalid packaged third-party notice path.');const bytes=read(file.path);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256||bytes.length!==file.size)throw new Error('A packaged runtime notice differs from its preserved source.');}
const themeRoot=path.join(`${archive}.unpacked`,'dist','interior-themes');
const themeCredits=JSON.parse(read('dist/interior-themes/credits.json').toString('utf8'));
if(!Array.isArray(themeCredits)||themeCredits.length!==11||new Set(themeCredits.map(photo=>photo.id)).size!==11)throw new Error('The packaged theme collection is incomplete.');
const realThemeRoot=realpathSync(themeRoot);
for(const photo of themeCredits){
 if(!/^[a-z]+(?:-[a-z]+)*$/.test(photo.id)||photo.src!==`/interior-themes/${photo.id}.jpg`)throw new Error('Invalid packaged theme path.');
 const filename=path.join(themeRoot,`${photo.id}.jpg`),info=lstatSync(filename),bytes=readFileSync(filename);
 if(!info.isFile()||info.isSymbolicLink()||realpathSync(filename)!==path.join(realThemeRoot,`${photo.id}.jpg`)||bytes.length!==photo.bytes||bytes.length>1048576||createHash('sha256').update(bytes).digest('hex')!==photo.sha256)throw new Error('A packaged theme photograph failed integrity checks.');
 if(!read(`dist/interior-themes/${photo.id}.jpg`).equals(bytes))throw new Error('Packaged theme index differs from its physical asset.');
}
console.log(`Packaged desktop inspection passed: ${metadata.platform}/${metadata.arch}, ${metadata.signing}, protected storage and identity enabled; ${licenses.packages.length} runtime dependency notices and ${themeCredits.length} licensed theme photographs preserved; no credential files.`);
