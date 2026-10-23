import { describe,it,expect } from 'vitest';
import { createDemoProject } from '../src/domain/seed';
import { exportIfc,importIfc } from '../src/io/ifc';

describe('bounded IFC STEP interoperability',()=>{
  it('round trips IDs, properties, dimensions, rotated origins and opening relationships',()=>{
    const source=createDemoProject();source.elements[0].externalId='0u4wgLe6n0EwNRcVlaYd_r';source.elements[0].properties={classification:'Slab',status:'Reviewed',factor:1.25,verified:true};
    source.elements[1]={...source.elements[1],name:"Architect's wall /* literal note */ ENDSEC;",x:8.2,y:3.4,z:1.7,rotation:37};
    const text=exportIfc(source);expect(text).toContain("FILE_SCHEMA(('IFC4'))");expect(text).toContain('IFCRELVOIDSELEMENT');
    const {project,report}=importIfc(text,source);expect(report.excluded).toBe(0);expect(report.imported).toBe(source.elements.length);expect(report.referenceOnly).toBe(0);
    for(const original of source.elements){const restored=project.elements.find(e=>e.id===original.id)!;expect(restored).toBeDefined();expect(restored.name).toBe(original.name);for(const field of ['x','y','z','width','depth','height','rotation']as const)expect(restored[field]).toBeCloseTo(original[field],6);expect(restored.properties).toEqual(original.properties);expect(restored.material).toBe(original.material);expect(restored.hostId).toBe(original.hostId);}
    expect(project.elements[0].externalId).toBe(source.elements[0].externalId);
  });
  it('stores canonical metres even when the project display unit is feet',()=>{const source=createDemoProject();source.units='ft';const {project}=importIfc(exportIfc(source),source);expect(project.elements[0].width).toBeCloseTo(source.elements[0].width,6);expect(project.units).toBe('ft');});
  it('normalises external millimetre coordinates into metres',()=>{const source=createDemoProject();source.elements=[{...source.elements[0],x:2000,y:3000,z:0,width:1000,depth:2000,height:200}];const text=exportIfc(source).replace('*,.LENGTHUNIT.,$,.METRE.','*,.LENGTHUNIT.,.MILLI.,.METRE.');const {project}=importIfc(text,createDemoProject());expect(project.elements[0].x).toBeCloseTo(2);expect(project.elements[0].width).toBeCloseTo(1);expect(project.elements[0].depth).toBeCloseTo(2);});
  it('reports unsupported geometry honestly instead of inventing editable solids',()=>{const source=createDemoProject();source.elements=[source.elements[0]];const text=exportIfc(source).replace(/IFCEXTRUDEDAREASOLID\(/g,'IFCUNKNOWNGEOMETRY(');const result=importIfc(text,source);expect(result.report.imported).toBe(0);expect(result.report.excluded+result.report.referenceOnly).toBe(1);expect(result.report.warnings.join(' ')).toMatch(/unsupported|Unsupported/);expect(result.project.elements.every(e=>!e.editable)).toBe(true);});
  it('rejects malformed STEP, duplicate entity IDs and unsupported schemas',()=>{expect(()=>importIfc('garbage',createDemoProject())).toThrow();const text=exportIfc(createDemoProject());expect(()=>importIfc(text.replace("('IFC4')","('IFCBOGUS')"),createDemoProject())).toThrow();expect(()=>importIfc(text.replace('DATA;','DATA;\n#1=IFCCARTESIANPOINT((0.,0.,0.));'),createDemoProject())).toThrow(/Duplicate/);});
  it('imports an independent IFC2X3 nested placement fixture and retains external GlobalId',()=>{
    const fixture=`ISO-10303-21;
HEADER;FILE_DESCRIPTION(('External fixture'),'2;1');FILE_NAME('fixture.ifc','2026-01-01',('test'),('test'),'test','test','');FILE_SCHEMA(('IFC2X3'));ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((10.,20.,3.));
#2=IFCDIRECTION((0.,0.,1.));
#3=IFCDIRECTION((0.,1.,0.));
#4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
#5=IFCLOCALPLACEMENT($,#4);
#6=IFCCARTESIANPOINT((2.,1.,0.));
#7=IFCAXIS2PLACEMENT3D(#6,$,$);
#8=IFCLOCALPLACEMENT(#5,#7);
#9=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,4.,0.2);
#10=IFCEXTRUDEDAREASOLID(#9,$,#2,2.7);
#11=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#10));
#12=IFCPRODUCTDEFINITIONSHAPE($,$,(#11));
#13=IFCWALL('1EHJTRRXz7xe50ltY0UArV',$,'External wall',$,$,#8,#12,$);
ENDSEC;END-ISO-10303-21;`;
    const {project,report}=importIfc(fixture,createDemoProject());expect(report.schema).toBe('IFC2X3');expect(report.imported).toBe(1);const wall=project.elements[0];expect(wall.externalId).toBe('1EHJTRRXz7xe50ltY0UArV');expect(wall.x).toBeCloseTo(9.1);expect(wall.y).toBeCloseTo(20);expect(wall.z).toBeCloseTo(3);expect(wall.rotation).toBeCloseTo(90);expect(project.types.find(t=>t.id===wall.typeId)?.materialRate).toBeNull();
  });
  it('keeps tessellated external objects read-only with a world-coordinate bounding proxy',()=>{
    const source=createDemoProject();source.elements=[source.elements[0]];let text=exportIfc(source);text=text.replace(/IFCEXTRUDEDAREASOLID\([^;]+;/,`IFCTRIANGULATEDFACESET(#999,$,.T.,((1,2,3)), $);`).replace('ENDSEC;\nEND-ISO', '#999=IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(4.,0.,0.),(0.,2.,3.)));\nENDSEC;\nEND-ISO');const {project,report}=importIfc(text,source);expect(report.referenceOnly).toBe(1);expect(report.imported).toBe(0);expect(project.elements[0].editable).toBe(false);expect(project.elements[0].kind).toBe('reference');expect(project.elements[0].width).toBeCloseTo(4);expect(project.elements[0].depth).toBeCloseTo(2);expect(project.elements[0].height).toBeCloseTo(3);
  });
});
