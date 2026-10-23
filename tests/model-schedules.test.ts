import { describe,expect,it } from 'vitest';
import * as XLSX from 'xlsx';
import { createDemoProject } from '../src/domain/seed';
import { modelSchedules } from '../src/model/schedules';
import { buildWorkbook,buildSchedulesCsv,buildReviewPdf } from '../src/io/exports';
import { buildSchedule,estimate,quantities } from '../src/engine';

describe('model-derived room, door and window schedules',()=>{
 it('retains every row, source ID, version and missing field instead of dropping incomplete rooms',()=>{
  const project=createDemoProject(),schedules=modelSchedules(project);
  expect(schedules.metadata).toMatchObject({version:project.version,geometryUnits:'m'});
  expect(schedules.rooms).toHaveLength(8);expect(schedules.doors).toHaveLength(7);expect(schedules.windows).toHaveLength(10);
  expect(schedules.rooms.every(row=>row.elementId&&row.level&&row.area>0)).toBe(true);
  expect(schedules.windows.every(row=>row.hostId&&row.sillHeight===.9)).toBe(true);
  expect(schedules.issues.join(' ')).toMatch(/Specification missing/);
 });
 it('updates dimensions, finish and material immediately from revised model data',()=>{
  const project=createDemoProject(),room=project.elements.find(element=>element.kind==='room')!;room.width=7;room.properties.finish='Stone';
  const window=project.elements.find(element=>element.kind==='window')!;window.material='Reviewed glass';
  const schedules=modelSchedules(project);
  expect(schedules.rooms.find(row=>row.elementId===room.id)).toMatchObject({area:39.2,finish:'Stone'});
  expect(schedules.windows.find(row=>row.elementId===window.id)?.material).toBe('Reviewed glass');
  project.units='ft';expect(modelSchedules(project).rooms.find(row=>row.elementId===room.id)?.area).toBe(39.2);
 });
 it('serializes a real workbook with all model schedule sheets and unit/provenance metadata',()=>{
  const project=createDemoProject(),schedule=buildSchedule(project),cost=estimate(project,schedule);
  const workbook=buildWorkbook(project,quantities(project),cost,schedule);
  const restored=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  expect(restored.SheetNames).toEqual(expect.arrayContaining(['Project','Quantities','Estimate','Rooms','Doors','Windows','Schedule','Assumptions']));
  const windows=XLSX.utils.sheet_to_json<Record<string,unknown>>(restored.Sheets.Windows);
  expect(windows).toHaveLength(10);expect(windows[0]).toMatchObject({ProjectVersion:project.version,GeometryUnits:'m',Count:1});
  expect(windows[0].Host).toBeTruthy();
 });
 it('escapes spreadsheet formula injection in both workbook and full-schedule CSV',()=>{
  const project=createDemoProject();project.elements.find(element=>element.kind==='room')!.name='=HYPERLINK("https://example.invalid")';
  const schedule=buildSchedule(project),workbook=buildWorkbook(project,quantities(project),estimate(project,schedule),schedule);
  const rooms=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets.Rooms);
  expect(rooms.find(row=>String(row.Room).includes('HYPERLINK'))?.Room).toMatch(/^'=/);
  expect(buildSchedulesCsv(project,'rooms')).toContain("'=HYPERLINK");
  expect(buildSchedulesCsv(project,'windows')).not.toContain('HYPERLINK');
 });
 it('builds PDF schedules through the installed jsPDF API with source IDs and metadata',()=>{
  const project=createDemoProject(),schedule=buildSchedule(project);
  const document=buildReviewPdf(project,estimate(project,schedule),schedule,quantities(project));
  const pdf=document.output();
  expect(pdf.startsWith('%PDF-')).toBe(true);
  for(const text of ['Room schedule','Door schedule','Window schedule','room-living','window-n1-00','Recorded rate currencies and sources'])expect(pdf).toContain(text);
  expect(document.getNumberOfPages()).toBeGreaterThan(10);
 });
});
