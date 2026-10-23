import { describe, expect, it } from 'vitest';
import { createBlankProject, createDemoProject } from '../src/domain/seed';
import { buildReviewPdf } from '../src/io/exports';
import { buildSchedule, estimate, quantities } from '../src/engine';
import { createPlanDrawing, createProjectionDrawing, footprintSection } from '../src/model/drawings';
import { footprint } from '../src/model/geometry';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PlanEditor from '../src/components/PlanEditor';

describe('coordinated drawing outputs',()=>{
 it('fits negative, offset and rotated geometry without assuming a zero origin',()=>{
  const project=createDemoProject();project.elements=project.elements.slice(0,1).map(e=>({...e,x:-45,y:-30,width:8,depth:3,rotation:37}));
  const drawing=createPlanDrawing(project,'level-0');
  expect(drawing.bounds.maxX).toBeLessThan(0);expect(drawing.bounds.maxY).toBeLessThan(0);
  for(const point of footprint(project.elements[0])){expect(point.x).toBeGreaterThanOrEqual(drawing.bounds.minX);expect(point.x).toBeLessThanOrEqual(drawing.bounds.maxX);expect(point.y).toBeGreaterThanOrEqual(drawing.bounds.minY);expect(point.y).toBeLessThanOrEqual(drawing.bounds.maxY);}
 });
 it('derives different native plans from each actual level',()=>{
  const project=createDemoProject(),ground=createPlanDrawing(project,'level-0'),upper=createPlanDrawing(project,'level-1');
  expect(ground.primitives.some(p=>p.text==='Living & dining')).toBe(true);
  expect(upper.primitives.some(p=>p.text==='Primary bedroom')).toBe(true);
  expect(upper.primitives.some(p=>p.text==='Living & dining')).toBe(false);
 });
 it('creates opening and stair vectors from their actual dimensions',()=>{
  const project=createDemoProject();project.elements=project.elements.filter(e=>['door-entry','window-n1-00','stair-main'].includes(e.id));
  const drawing=createPlanDrawing(project,'level-0',false);
  expect(drawing.primitives.some(p=>p.kind==='polyline'&&p.points.length===15)).toBe(true);
  expect(drawing.primitives.filter(p=>p.kind==='polyline').length).toBeGreaterThan(16);
 });
 it('intersects rotated footprints at the specified section plane',()=>{
  const project=createDemoProject();const wall=project.elements.find(e=>e.id==='wall-e-00')!;
  const slice=footprintSection(footprint(wall),4)!;expect(slice.min).toBeCloseTo(11.8);expect(slice.max).toBeCloseTo(12);
  expect(footprintSection(footprint(wall),12)).toBeNull();
 });
 it('has honest empty drawing states and display-unit dimension labels',()=>{
  const blank=createBlankProject('Empty');expect(createPlanDrawing(blank,'level-0').empty).toBe(true);expect(createProjectionDrawing(blank,'section').empty).toBe(true);
  const project=createDemoProject();project.units='ft';expect(createPlanDrawing(project,'level-0').primitives.some(p=>p.text?.endsWith(' ft'))).toBe(true);
 });
 it('retains element identifiers for native projected selection and renders shared units/datums',()=>{
  const project=createDemoProject();project.units='ft';
  const drawing=createProjectionDrawing(project,'elevation');
  expect(drawing.primitives.some(p=>p.elementId==='window-s1-00')).toBe(true);
  const html=renderToStaticMarkup(createElement(PlanEditor,{project,selectedIds:['window-s1-00'],onSelect:()=>{},viewMode:'elevation',activeLevelId:'level-0',tool:'select',onCreate:()=>{},onUpdate:()=>{},showGrid:true,ghostUpper:false,fitKey:0}));
  expect(html).toContain('aria-label="W-0003"');expect(html).toContain('aria-pressed="true"');expect(html).toContain('First floor +10.50 ft');expect(html).toContain('Orthographic projection looking north');
 });
 it('updates manual annotations in live plans and coordinated drawing data with provenance',()=>{
  const project=createDemoProject(),wall=project.elements.find(e=>e.id==='wall-n-00')!;
  wall.properties.annotation='Confirm acoustic lining';
  const first=createPlanDrawing(project,'level-0');
  expect(first.primitives.find(p=>p.text==='Confirm acoustic lining')).toMatchObject({elementId:wall.id,sourceProperty:'properties.annotation'});
  wall.properties.annotation='Revised lining specification';
  const updated=createPlanDrawing(project,'level-0');expect(updated.primitives.some(p=>p.text==='Confirm acoustic lining')).toBe(false);expect(updated.primitives.some(p=>p.text==='Revised lining specification')).toBe(true);
  const html=renderToStaticMarkup(createElement(PlanEditor,{project,selectedIds:[],onSelect:()=>{},viewMode:'plan',activeLevelId:'level-0',tool:'select',onCreate:()=>{},onUpdate:()=>{},showGrid:true,ghostUpper:false,fitKey:0}));
  expect(html).toContain('Revised lining specification');expect(html).toContain('data-element-id="wall-n-00"');expect(html).toContain('pointer-events:none');expect(html).toContain('12.30 m');
 });
 it('builds a real multipage vector review with all levels, provenance and objective',()=>{
  const project=createDemoProject(),schedule=buildSchedule(project),cost=estimate(project,schedule);
  const doc=buildReviewPdf(project,cost,schedule,quantities(project),[],'time');
  const content=doc.output();expect(content.startsWith('%PDF-')).toBe(true);expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(8);
  expect(content).toContain('Ground floor plan');expect(content).toContain('First floor plan');expect(content).toContain('Building section A-A');expect(content).toContain('South elevation');
  expect(content).toContain('Earliest estimated completion within budget');expect(content).toContain(project.id);expect(content).toContain('Source last updated:');
 });
});
