import {describe,expect,it} from 'vitest';
import {FURNITURE_CATALOG,INTERIOR_STYLES} from '../src/interior/catalog';
import {interiorStateSchema} from '../src/interior/schema';
import {createBlankProject} from '../src/domain/seed';
import {interiorState,suggestRoomArrangement} from '../src/interior/model';
const original=['japandi','japanese','modern','scandinavian','contemporary'];
const added=['tropical-modern','kerala-contemporary','mid-century','industrial','coastal','bohemian'];
describe('curated interior design directions',()=>{
 it('retains all saved style IDs while extending the selectable collection',()=>{
  expect(new Set(INTERIOR_STYLES.map(style=>style.id)).size).toBe(11);for(const id of [...original,...added]){expect(INTERIOR_STYLES.some(style=>style.id===id)).toBe(true);expect(interiorStateSchema.safeParse({schemaVersion:1,styleId:id,placements:[],references:[]}).success).toBe(true);}expect(interiorState(createBlankProject('Older project')).styleId).toBe('japandi');
 });
 it('provides useful distinct palettes, material and lighting guidance backed by primary design sources',()=>{
  for(const style of INTERIOR_STYLES){expect(style.description.length).toBeGreaterThan(40);expect(style.palette.length).toBeGreaterThanOrEqual(3);for(const colour of style.palette)expect(colour).toMatch(/^#[a-f\d]{6}$/i);expect(style.materials.length).toBeGreaterThanOrEqual(3);expect(style.lighting.length).toBeGreaterThan(35);expect(style.tags.length).toBeGreaterThanOrEqual(3);expect(style.sources.length).toBeGreaterThan(0);for(const source of style.sources){expect(source.title.length).toBeGreaterThan(8);const url=new URL(source.url);expect(url.protocol).toBe('https:');expect(url.pathname).not.toMatch(/\/search\/?$/);expect(source.url).not.toMatch(/pinterest|google\.com\/search/i);}}
  expect(new Set(INTERIOR_STYLES.map(style=>style.palette.join(','))).size).toBe(11);expect(INTERIOR_STYLES.find(style=>style.id==='kerala-contemporary')?.description).toMatch(/not a compliance check/);
 });
 it('matches new themes to existing sourced furniture without changing any SKU envelope or claiming availability',()=>{
  for(const styleId of added){const matches=FURNITURE_CATALOG.filter(asset=>asset.styles.includes(styleId));expect(matches.length).toBeGreaterThanOrEqual(4);expect(new Set(matches.map(asset=>asset.category)).size).toBeGreaterThanOrEqual(3);}
  const dimensions:Record<string,number[]>={'ikea-kivik-3-seat':[2.28,.95,.83],'ikea-klippan-2-seat':[1.8,.88,.66],'ikea-lisabo-chair':[.46,.51,.8],'ikea-malm-bed-160':[1.76,2.09,1],'ikea-micke-desk-142':[1.42,.5,.75],'ikea-micke-desk-73':[.73,.5,.75],'ikea-lisabo-table':[1.4,.78,.74],'ikea-lack-side-table':[.55,.55,.45],'ikea-billy-bookcase':[.8,.28,2.02]};
  for(const asset of FURNITURE_CATALOG){expect([asset.width,asset.depth,asset.height]).toEqual(dimensions[asset.id]);expect(asset.source.availability).toBe('unverified');expect(asset.source.url).toMatch(/^https:\/\/www\.ikea\.com\/in\/en\/p\//);for(const styleId of asset.styles)expect(INTERIOR_STYLES.some(style=>style.id===styleId)).toBe(true);}
 });
 it('uses every new theme for fit-checked room suggestions while leaving the architecture and saved furniture intact',()=>{
  const project=createBlankProject('Theme suggestions');project.elements=[{id:'living',name:'Living',kind:'room',levelId:project.levels[0].id,typeId:'',material:'Air',x:0,y:0,z:0,width:6,depth:5,height:2.8,rotation:0,editable:true,properties:{use:'living'}}];const before=structuredClone(project);
  for(const styleId of added){const result=suggestRoomArrangement(project,'living',styleId);expect(result.placements.length).toBeGreaterThan(0);expect(result.placements.some(placement=>FURNITURE_CATALOG.find(asset=>asset.id===placement.assetId)?.styles.includes(styleId))).toBe(true);expect(project).toEqual(before);}
 });
 it('requires bundled reference images to retain credit and license provenance when assigned',()=>{
  for(const style of INTERIOR_STYLES.filter(style=>style.image)){const image=style.image!;expect(image.src).toBe(`/interior-themes/${style.id}.jpg`);expect(image.alt.length).toBeGreaterThan(10);expect(image.credit.length).toBeGreaterThan(3);expect(new URL(image.sourceUrl).protocol).toBe('https:');expect(new URL(image.licenseUrl).protocol).toBe('https:');}
 });
});
