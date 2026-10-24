import {afterEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {cp,lstat,mkdir,mkdtemp,open,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createPackageWithOptions,extractFile,statFile} from '@electron/asar';
import {INTERIOR_STYLES} from '../src/interior/catalog';
import {THEME_IMAGES} from '../src/interior/themeImages';

interface Credit {id:string;src:string;alt:string;credit:string;sourceUrl:string;licenseUrl:string;downloadUrl?:string;sourceImageUrl?:string;bytes:number;sha256:string;verifiedAt:string;license:string;modifications:string;notes:string;width?:number;height?:number}
const directory=path.resolve('public/interior-themes'),temporary=new Set<string>();
const credits=JSON.parse(await readFile(path.join(directory,'credits.json'),'utf8')) as Credit[];
afterEach(async()=>{for(const name of temporary)await rm(name,{recursive:true,force:true});temporary.clear();});
function jpegDimensions(bytes:Buffer){
 expect(bytes.subarray(0,2)).toEqual(Buffer.from([255,216]));expect(bytes.subarray(-2)).toEqual(Buffer.from([255,217]));
 let offset=2;while(offset+4<bytes.length){expect(bytes[offset++]).toBe(255);while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===218||marker===217)break;if(marker===1||marker>=208&&marker<=215)continue;const length=bytes.readUInt16BE(offset);expect(length).toBeGreaterThanOrEqual(2);expect(offset+length).toBeLessThanOrEqual(bytes.length);if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){expect(length).toBeGreaterThanOrEqual(8);return{width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};}offset+=length;}
 throw new Error('Bundled photograph has no valid JPEG frame header.');
}
function publicHttps(value:string){const url=new URL(value);expect(url.protocol).toBe('https:');expect(url.username).toBe('');expect(url.password).toBe('');expect(url.hash).toBe('');return url;}

describe('bundled licensed theme photograph integrity',()=>{
 it('ships exactly one photograph and complete provenance for every selectable style',async()=>{
  const ids=INTERIOR_STYLES.map(style=>style.id).sort();expect(ids).toHaveLength(11);expect(new Set(credits.map(credit=>credit.id)).size).toBe(11);expect(credits.map(credit=>credit.id).sort()).toEqual(ids);expect(Object.keys(THEME_IMAGES).sort()).toEqual(ids);expect((await readdir(directory)).filter(name=>name.endsWith('.jpg')).sort()).toEqual(ids.map(id=>`${id}.jpg`));
 });
 it.each(credits)('$id has its recorded JPEG bytes, dimensions, license and matching UI metadata',async credit=>{
  const style=INTERIOR_STYLES.find(style=>style.id===credit.id)!;expect(credit.src).toBe(`/interior-themes/${credit.id}.jpg`);const filename=path.join(directory,`${credit.id}.jpg`),info=await lstat(filename);expect(info.isFile()).toBe(true);expect(info.isSymbolicLink()).toBe(false);const bytes=await readFile(filename);expect(bytes.length).toBe(credit.bytes);expect(bytes.length).toBeGreaterThan(1024);expect(bytes.length).toBeLessThanOrEqual(1024*1024);expect(createHash('sha256').update(bytes).digest('hex')).toBe(credit.sha256);expect(credit.sha256).toMatch(/^[a-f0-9]{64}$/);
  const dimensions=jpegDimensions(bytes);expect(dimensions.width).toBeGreaterThanOrEqual(800);expect(dimensions.height).toBeGreaterThanOrEqual(600);expect(dimensions.width*dimensions.height).toBeLessThanOrEqual(20_000_000);if(credit.width!==undefined)expect(dimensions.width).toBe(credit.width);if(credit.height!==undefined)expect(dimensions.height).toBe(credit.height);
  expect(style.image).toEqual({src:credit.src,alt:credit.alt,credit:credit.credit,sourceUrl:credit.sourceUrl,licenseUrl:credit.licenseUrl});expect(THEME_IMAGES[credit.id]).toEqual(style.image);expect(credit.credit).toContain('Unsplash');expect(credit.alt.length).toBeGreaterThan(20);expect(credit.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);expect(Number.isFinite(Date.parse(credit.verifiedAt))).toBe(true);expect(credit.modifications).toContain('no generative edits');expect(credit.notes).toMatch(/reference|[Aa]tmosphere|[Uu]sed only to illustrate/);
  const source=publicHttps(credit.sourceUrl);expect(source.hostname).toBe('unsplash.com');expect(source.pathname).toMatch(/^\/photos\/[^/]+$/);expect(publicHttps(credit.licenseUrl).href).toBe('https://unsplash.com/license');expect(credit.license).toBe('Unsplash License');const download=publicHttps(credit.downloadUrl??credit.sourceImageUrl??'');expect(download.hostname).toBe('images.unsplash.com');expect(download.pathname).toMatch(/^\/photo-/);for(const source of style.sources){expect(source.title.length).toBeGreaterThan(8);publicHttps(source.url);}
 });
 it('retains human-readable source credits and the Bali attribution limitation',async()=>{
  const licenses=await readFile(path.join(directory,'LICENSES.md'),'utf8');for(const credit of credits){expect(licenses).toContain(credit.id);expect(licenses).toContain(credit.credit);expect(licenses).toContain(credit.sourceUrl);}expect(licenses).toContain('https://unsplash.com/license');expect(licenses).toContain('not a Kerala property');expect(credits.find(credit=>credit.id==='kerala-contemporary')!.notes).toContain('Bali');
 });
 it('physically unpacks the configured theme directory while keeping the app shell inside ASAR',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'atelier-theme-asar-'));temporary.add(root);const stage=path.join(root,'stage'),archive=path.join(root,'app.asar');await mkdir(path.join(stage,'dist'),{recursive:true});await cp(directory,path.join(stage,'dist','interior-themes'),{recursive:true});await writeFile(path.join(stage,'dist','index.html'),'<main>Atelier fixture</main>');
  // Matches scripts/build-desktop.mjs; this small fixture exercises the real ASAR implementation.
  await createPackageWithOptions(stage,archive,{unpackDir:'dist/interior-themes'});const unpacked=await realpath(path.join(`${archive}.unpacked`,'dist','interior-themes'));
  expect(statFile(archive,path.join('dist','index.html')).unpacked).not.toBe(true);expect(extractFile(archive,path.join('dist','index.html')).toString()).toContain('Atelier fixture');
  for(const credit of credits){const entry=path.join('dist','interior-themes',`${credit.id}.jpg`);expect(statFile(archive,entry).unpacked).toBe(true);const filename=path.join(unpacked,`${credit.id}.jpg`),info=await lstat(filename);expect(await realpath(filename)).toBe(filename);expect(info.isFile()).toBe(true);expect(info.isSymbolicLink()).toBe(false);const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);try{const current=await handle.stat();expect(current.dev).toBe(info.dev);expect(current.ino).toBe(info.ino);const bytes=await handle.readFile();expect(createHash('sha256').update(bytes).digest('hex')).toBe(credit.sha256);expect(extractFile(archive,entry).equals(bytes)).toBe(true);}finally{await handle.close();}}
  expect(JSON.parse(await readFile(path.join(unpacked,'credits.json'),'utf8'))).toEqual(credits);expect(await readFile(path.join(unpacked,'LICENSES.md'),'utf8')).toContain('Interior theme image credits');
 });
});
