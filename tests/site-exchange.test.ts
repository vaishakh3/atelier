import {describe,expect,it} from 'vitest';
import {exportSiteGeoJson,exportSiteObj,parseSiteDxf,parseSiteObj,parseSurveyTerrain,placedAssetGeometry,rasterContext,rasterDimensions,terrainFromAsset} from '../src/site/exchange';
import {emptySiteContext} from '../src/site/types';
import {siteContextSchema} from '../src/site/schema';
const square='v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\nf 1 2 3 4\nl 1 2\n';
const dxf=(content:string)=>`0\nSECTION\n2\nENTITIES\n${content}0\nENDSEC\n0\nEOF\n`;
describe('Bounded context exchange with exact accepted geometry',()=>{
 it('triangulates a planar convex OBJ, resolves negative indices and reports excluded appearance/freeform records',()=>{
  const asset=parseSiteObj(square+'f -4 -3 -2\nusemtl secret-path\ncurv 0 1 1 2\n','Survey mesh');
  expect(asset.faces).toEqual([[0,1,2],[0,2,3],[0,1,2]]);expect(asset.lines).toEqual([[0,1]]);expect(asset.report.excluded).toBe(1);
  expect(asset.report.warnings.join(' ')).toContain('No external files were loaded');
  expect(asset.report.accepted).toBe(3);
 });
 it('excludes non-planar and concave OBJ faces rather than silently fan filling them',()=>{
  const concave='v 0 0 0\nv 3 0 0\nv 1 1 0\nv 3 3 0\nv 0 3 0\nf 1 2 3 4 5\nl 1 2\n';
  const asset=parseSiteObj(concave);expect(asset.faces).toHaveLength(0);expect(asset.report.excluded).toBe(1);
  expect(()=>parseSiteObj('v 0 0 0\nv 1 0 0\nv 1 1 1\nv 0 1 0\nf 1 2 3 4')).toThrow(/No supported/);
  const star=Array.from({length:5},(_,i)=>`v ${Math.cos(i*2*Math.PI/5)} ${Math.sin(i*2*Math.PI/5)} 0`).join('\n')+'\nf 1 3 5 2 4\nl 1 2';expect(parseSiteObj(star).faces).toHaveLength(0);
 });
 it('applies explicit units, scale, rotation and origin without changing source vertices',()=>{
  const asset=parseSiteObj(square);asset.placement={units:'mm',scale:1000,rotation:90,origin:{x:10,y:20,z:3}};const before=structuredClone(asset),placed=placedAssetGeometry(asset);
  expect(placed.vertices[1].x).toBeCloseTo(10);expect(placed.vertices[1].y).toBeCloseTo(22);expect(placed.vertices[1].z).toBe(3);expect(asset).toEqual(before);
  const site={...emptySiteContext(),contexts:[asset]},roundTrip=parseSiteObj(exportSiteObj(site));expect(roundTrip.vertices[1].x).toBeCloseTo(10);expect(roundTrip.vertices[1].y).toBeCloseTo(22);
  const yUp=parseSiteObj(square);yUp.placement.upAxis='y';expect(placedAssetGeometry(yUp).vertices[2]).toEqual({x:2,y:0,z:2});
 });
 it('retains DXF straight lines and closed lightweight polylines and excludes unsupported curves',()=>{
  const asset=parseSiteDxf(dxf('0\nLINE\n10\n1\n20\n2\n11\n3\n21\n4\n0\nLWPOLYLINE\n90\n3\n70\n1\n10\n0\n20\n0\n10\n4\n20\n0\n10\n4\n20\n3\n0\nCIRCLE\n10\n0\n20\n0\n40\n2\n'));
  expect(asset.lines).toHaveLength(2);expect(asset.lines[1]).toHaveLength(4);expect(asset.lines[1][0]).toBe(asset.lines[1].at(-1));expect(asset.report.accepted).toBe(2);expect(asset.report.excluded).toBe(1);expect(asset.faces).toEqual([]);
  expect(()=>parseSiteDxf(dxf('0\nLINE\n10\n1\n20\n2\n'))).toThrow(/No supported/);
 });
 it('does not approximate bulged DXF polylines or broken group pairs',()=>{
  expect(()=>parseSiteDxf(dxf('0\nLWPOLYLINE\n90\n2\n10\n0\n20\n0\n42\n1\n10\n2\n20\n2\n'))).toThrow(/No supported/);
  expect(()=>parseSiteDxf('0\nLINE\n10')).toThrow(/Malformed/);
 });
 it('preserves legacy 2D POLYLINE header elevation and rejects missing vertex XY',()=>{
  const elevated=parseSiteDxf(dxf('0\nPOLYLINE\n70\n0\n30\n7.5\n0\nVERTEX\n10\n0\n20\n0\n30\n0\n0\nVERTEX\n10\n4\n20\n3\n30\n0\n0\nSEQEND\n'));
  expect(elevated.vertices.map(vertex=>vertex.z)).toEqual([7.5,7.5]);
  expect(()=>parseSiteDxf(dxf('0\nPOLYLINE\n70\n0\n0\nVERTEX\n10\n0\n0\nVERTEX\n10\n4\n20\n3\n0\nSEQEND\n'))).toThrow(/No supported/);
  expect(()=>parseSiteDxf(dxf('0\nPOLYLINE\n70\n2\n0\nVERTEX\n10\n0\n20\n0\n0\nVERTEX\n10\n4\n20\n3\n0\nSEQEND\n'))).toThrow(/No supported/);
  expect(()=>parseSiteDxf(dxf('0\nLWPOLYLINE\n90\n2\n10\n0\n10\n1\n20\n0\n10\n2\n20\n0\n'))).toThrow(/No supported/);
 });
 it('retains survey XYZ as points and only uses explicit mesh faces for terrain',()=>{
  const terrain=parseSurveyTerrain('0,0,1\n1,0,2\n0,1,3','Surveyor test / model datum');expect(terrain.vertices).toHaveLength(3);expect(terrain.faces).toEqual([]);
  expect(()=>parseSurveyTerrain('id,1,2,3','survey')).toThrow(/exactly/);expect(()=>parseSurveyTerrain('0,0,0','')).toThrow(/source/);
  expect(terrainFromAsset(parseSiteObj(square),'Verified source').faces).toHaveLength(2);
 });
 it('uses safe bounded raster content, excludes images from OBJ and rejects SVG disguised as a PNG',()=>{
  const asset=rasterContext('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',1,1,'Reference.png');expect(asset.format).toBe('image');expect(asset.placement.scale).toBe(20);
  expect(()=>rasterContext('data:image/svg+xml;base64,PHN2Zz4=',1,1,'bad.png')).toThrow();
  expect(()=>rasterContext('data:image/png;base64,PHN2Zz4=',1,1,'disguised.png')).toThrow();
  expect(exportSiteObj({...emptySiteContext(),contexts:[asset]})).not.toContain('data:');
  expect(()=>terrainFromAsset(asset,'Raster source')).toThrow(/pixels/);
 });
 it('exports approximate two-dimensional geographic context without mislabelling local Z as ellipsoidal altitude',()=>{
  const asset=parseSiteObj(square),site={...emptySiteContext(),latitude:0,longitude:0,trueNorthAngle:0,contexts:[asset]};
  const geo=exportSiteGeoJson(site),first=(geo.features[0].geometry.geometries[0]as {coordinates:number[][][]}).coordinates[0];
  expect(first[1]).toHaveLength(2);expect(first[1][0]).toBeCloseTo(2/111319.490793,8);expect(geo.features[0].properties.modelZByVertex).toEqual([0,0,0,0]);
  asset.placement.origin.x=20000;expect(()=>exportSiteGeoJson(site)).toThrow(/10 km/);
  expect(()=>exportSiteGeoJson({...site,longitude:Infinity})).toThrow();
 });
 it('rejects invalid geometry references and aggregate context budgets in the persisted schema',()=>{
  const asset=parseSiteObj(square);asset.faces[0][0]=100;expect(siteContextSchema.safeParse({...emptySiteContext(),contexts:[asset]}).success).toBe(false);
  const duplicate=parseSiteObj(square);expect(siteContextSchema.safeParse({...emptySiteContext(),contexts:[duplicate,duplicate]}).success).toBe(false);
 });
 it('preflights compressed raster dimensions and bounds accumulated geometry before expensive decoding/rendering',()=>{
  const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10],0);png.set([73,72,68,82],12);const view=new DataView(png.buffer);view.setUint32(16,100000);view.setUint32(20,100000);expect(()=>rasterDimensions(png)).toThrow(/before decoding/);
  view.setUint32(16,100);view.setUint32(20,50);expect(rasterDimensions(png)).toEqual({width:100,height:50,mime:'image/png'});
  expect(rasterDimensions(new Uint8Array([255,216,255,192,0,7,8,0,1,0,2]))).toEqual({width:2,height:1,mime:'image/jpeg'});
  expect(()=>parseSiteObj('v 0 0 0\nv 1 0 0\nv 0 1 0\n'+'f 1 2 3\n'.repeat(10001))).toThrow(/10,000 triangles/);
  const a=rasterContext('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',4000,4000,'a.png'),b={...a,id:'second-image'};expect(siteContextSchema.safeParse({...emptySiteContext(),contexts:[a,b]}).success).toBe(false);
 });
});
