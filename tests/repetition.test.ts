import { describe,expect,it } from 'vitest';
import { createDemoProject } from '../src/domain/seed';
import { previewRepetition } from '../src/domain/repetition';
const request={sourceIds:['wall-n-00'],count:2,offsetX:15,offsetY:0,idPrefix:'review-123'};

describe('bounded repetitive modelling preview',()=>{
 it('copies walls with their children and preserves new host relationships without mutating sources',()=>{
  const project=createDemoProject();project.elements.find(element=>element.id==='wall-n-00')!.externalId='0u4wgLe6n0EwNRcVlaYd_r';
  const before=JSON.stringify(project),preview=previewRepetition(project,request);
  expect(preview.issues).toEqual([]);expect(preview.elements).toHaveLength(6);
  for(let copy=1;copy<=2;copy++){
    const wall=preview.elements.find(element=>element.id===`review-123-wall-n-00-${copy}`)!;
    expect(wall.x).toBe(15*copy);expect(wall.externalId).toBeUndefined();
    const openings=preview.elements.filter(element=>element.hostId===wall.id);expect(openings).toHaveLength(2);
    expect(openings[0].x).toBeCloseTo(project.elements.find(element=>element.id==='window-n1-00')!.x+15*copy);
  }
  expect(JSON.stringify(project)).toBe(before);expect(preview).toEqual(previewRepetition(project,request));
 });
 it('deduplicates children selected alongside the wall and detaches property records',()=>{
  const project=createDemoProject(),preview=previewRepetition(project,{...request,sourceIds:['wall-n-00','window-n1-00','wall-n-00'],count:1});
  expect(preview.elements).toHaveLength(3);expect(preview.sourceIds).toHaveLength(3);
  preview.elements[0].properties.specification='Changed preview';
  expect(project.elements.find(element=>element.id==='wall-n-00')!.properties.specification).toBeUndefined();
 });
 it('rejects locked/read-only sources and the combined hosted-child cap',()=>{
  const project=createDemoProject();project.constraints.lockedElementIds=['window-n1-00'];
  expect(previewRepetition(project,request).elements).toHaveLength(0);
  project.constraints.lockedElementIds=[];
  expect(previewRepetition(project,{...request,count:34}).issues.join(' ')).toMatch(/more than 100/);
  project.elements.find(element=>element.id==='wall-n-00')!.editable=false;
  expect(previewRepetition(project,request).issues.join(' ')).toMatch(/read-only/);
 });
 it('rejects opening-only translations outside their existing host and deterministic ID reuse',()=>{
  const project=createDemoProject();
  expect(previewRepetition(project,{...request,sourceIds:['window-n1-00'],count:1}).issues.join(' ')).toMatch(/outside host/);
  const preview=previewRepetition(project,request);project.elements.push(...preview.elements);
  expect(previewRepetition(project,request).issues.join(' ')).toMatch(/already exists/);
 });
 it('validates type, offsets and counts before returning any created elements',()=>{
  const project=createDemoProject();expect(previewRepetition(project,{...request,offsetX:0}).issues.join(' ')).toMatch(/coincident/);
  expect(previewRepetition(project,{...request,count:1.5}).elements).toHaveLength(0);
  project.elements.find(element=>element.id==='wall-n-00')!.typeId='missing';
  expect(previewRepetition(project,request).issues.join(' ')).toMatch(/component type/);
 });
});
