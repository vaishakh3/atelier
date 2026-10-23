import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { createBlankProject } from '../src/domain/seed';
import { importIfc } from '../src/io/ifc';
import { quantities } from '../src/engine';
import manifest from './fixtures/ifc/provenance.json';
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/ifc/${name}`,import.meta.url),'utf8');

describe('independently authored buildingSMART IFC examples',()=>{
 it('pins unmodified upstream fixture bytes and source provenance independently of our exporter',()=>{
  expect(manifest.commit).toMatch(/^[a-f0-9]{40}$/);
  for(const file of manifest.files){const bytes=readFileSync(new URL(`./fixtures/ifc/${file.file}`,import.meta.url));expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);expect(bytes.byteLength).toBe(file.bytes);expect(file.modified).toBe(false);expect(file.source).toContain(manifest.commit);}
 });
 it('imports the external millimetre wall with inherited type and layered material names',()=>{
  const result=importIfc(fixture('wall-extruded-solid.ifc'),createBlankProject('External fixture'));
  expect(result.report).toMatchObject({schema:'IFC4X3_ADD2',imported:1,referenceOnly:0,excluded:0,source:{lengthUnitScale:.001,unitsDeclared:true,entityCount:46}});
  const wall=result.project.elements[0];expect(wall).toMatchObject({externalId:'0DWgwt6o1FOx7466fPk$jl',kind:'wall',x:0,y:0,z:0,width:5,depth:.27,height:2,material:'Masonry - Brick - Brown / Masonry'});
  expect(result.project.types.find(type=>type.id===wall.typeId)).toMatchObject({name:'Double Brick - 270',approved:false,materialRate:null});
  expect(wall.properties.IFCTypeGlobalId).toBe('2aG1gZj7PD2PztLOx2$IVX');
  expect(quantities(result.project)[0]).toMatchObject({quantity:2.7,unit:'m³'});
  expect(result.report.warnings.join(' ')).toMatch(/layer thicknesses.*not reconstructed/);
 });
 it('explicitly excludes the external arc-profile slab rather than inventing rectangular or undersized proxy geometry',()=>{
  const result=importIfc(fixture('slab-extruded-solid.ifc'),createBlankProject('External fixture'));
  expect(result.report).toMatchObject({imported:0,referenceOnly:0,excluded:1});
  expect(result.project.elements).toHaveLength(0);
  expect(result.report.warnings.join(' ')).toMatch(/Arbitrary profile has no safely bounded straight polygon/);
 });
 it('retains a tessellated slab only as a world bounding proxy and source GlobalId',()=>{
  const result=importIfc(fixture('slab-tessellated-unique-vertices.ifc'),createBlankProject('External fixture'));
  expect(result.report).toMatchObject({referenceOnly:1,imported:0,excluded:0});
  const element=result.project.elements[0];expect(element).toMatchObject({externalId:'35DHdKriP6OQIQhodN2chQ',kind:'reference',editable:false,width:20});
  expect(element.height).toBeCloseTo(.3,6);expect(quantities(result.project)[0].quantity).toBe(0);
 });
 it('bounds a straight L-profile extrusion as reference-only without measuring its bounding box as floor area',()=>{
  const text=`ISO-10303-21;HEADER;FILE_DESCRIPTION(('Independent polygon regression'),'2;1');FILE_NAME('L.ifc','2026-10-24',('Atelier test'),('Atelier'),'test','test','');FILE_SCHEMA(('IFC4'));ENDSEC;DATA;
#1=IFCCARTESIANPOINT((0.,0.));#2=IFCCARTESIANPOINT((4.,0.));#3=IFCCARTESIANPOINT((4.,1.));#4=IFCCARTESIANPOINT((1.,1.));#5=IFCCARTESIANPOINT((1.,3.));#6=IFCCARTESIANPOINT((0.,3.));
#7=IFCPOLYLINE((#1,#2,#3,#4,#5,#6,#1));#8=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'L profile',#7);#9=IFCDIRECTION((0.,0.,1.));#10=IFCEXTRUDEDAREASOLID(#8,$,#9,0.25);#11=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#10));#12=IFCPRODUCTDEFINITIONSHAPE($,$,(#11));#13=IFCSLAB('0DWgwt6o1FOx7466fPk$jl',$,'L-shaped slab',$,$,$,#12,$,.FLOOR.);#14=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);ENDSEC;END-ISO-10303-21;`;
  const result=importIfc(text,createBlankProject('Polygon'));
  expect(result.report).toMatchObject({imported:0,referenceOnly:1,excluded:0});
  expect(result.project.elements[0]).toMatchObject({kind:'reference',width:4,depth:3,height:.25,editable:false});
  expect(quantities(result.project)[0].quantity).toBe(0);
 });
});
