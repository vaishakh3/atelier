import {recordUsage} from '../domain/usage';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { Project, CostResult, ScheduleResult, Scenario, QuantityLine } from '../domain/types';
import { createPlanDrawing, createProjectionDrawing } from '../model/drawings';
import type { DrawingData } from '../model/drawings';
import { modelSchedules } from '../model/schedules';
import {assessPlanning} from '../engine/planningChecks';
export { modelSchedules } from '../model/schedules';
export type { ModelSchedules, RoomScheduleRow, OpeningScheduleRow } from '../model/schedules';
export const calculationVersions={geometry:'rectangular-union-v2',quantities:'hosted-union-v2',cost:'currency-components-v2',schedule:'resource-holiday-assembly-v2',scenarios:'bounded-v1',revisions:'semantic-diff-v1',modelSchedules:'per-element-v1',planning:'planning-checks-v1'} as const;
export function downloadFile(name:string,content:string|Blob,type='text/plain'){const blob=typeof content==='string'?new Blob([content],{type}):content;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const slug=(p:Project)=>p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'project';
const safeCell=(s:unknown)=>typeof s==='string'&&/^[=+@-]/.test(s)?`'${s}`:s;
export function buildWorkbook(project:Project,quantityLines:QuantityLine[],cost:CostResult,schedule:ScheduleResult){
 const wb=XLSX.utils.book_new();
 const schedules=modelSchedules(project),source={ProjectVersion:project.version,GeometryUnits:'m'};
 const sheets:Record<string,Record<string,unknown>[]>={
  'Project':[{Project:project.name,Version:project.version,Units:project.units,Currency:project.currency,Status:'Preliminary · project rate sources require confirmation',Updated:project.updatedAt,...Object.fromEntries(Object.entries(calculationVersions).map(([engine,version])=>[`${engine}Engine`,version]))}],
  'Quantities':quantityLines.map(q=>({Element:q.elementId,Name:q.name,Class:q.kind,Quantity:q.quantity,Unit:q.unit,Rule:q.formula,Issues:q.issues.join('; ')})),
  'Estimate':cost.lines.map(l=>({Item:l.name,Source:l.sourceIds.join(', '),Quantity:l.quantity,Unit:l.unit,Material:l.material,Labour:l.labour,Equipment:l.equipment,Waste:l.waste,Total:l.total,Formula:l.formula,RateDate:l.rateDate,RateCurrency:l.rateCurrency??project.currency,RateSource:l.rateSource??'',Issues:l.issues.join('; ')})),
  'Rooms':schedules.rooms.map(row=>({...source,Element:row.elementId,ExternalID:row.externalId,Number:row.number,Room:row.name,Level:row.level,Type:row.typeName,Area:row.area,AreaUnit:row.areaUnit,Width:row.width,Depth:row.depth,Use:row.use,Finish:row.finish,Classification:row.classification,Issues:row.issues.join('; ')})),
  'Doors':schedules.doors.map(row=>({...source,Element:row.elementId,ExternalID:row.externalId,Mark:row.mark,Level:row.level,Type:row.typeName,Material:row.material,Width:row.width,Height:row.height,SillHeight:row.sillHeight,Count:row.count,Host:row.hostId,HostName:row.hostName,FireRating:row.fireRating,Classification:row.classification,Specification:row.specification,Issues:row.issues.join('; ')})),
  'Windows':schedules.windows.map(row=>({...source,Element:row.elementId,ExternalID:row.externalId,Mark:row.mark,Level:row.level,Type:row.typeName,Material:row.material,Width:row.width,Height:row.height,SillHeight:row.sillHeight,Count:row.count,Host:row.hostId,HostName:row.hostName,FireRating:row.fireRating,Classification:row.classification,Specification:row.specification,Issues:row.issues.join('; ')})),
  'Schedule':schedule.activities.map(a=>({ID:a.id,Activity:a.name,Quantity:a.quantity,Unit:a.unit,Productivity:a.productivity,Duration:a.duration,Start:a.startDate,Finish:a.finishDate,Crews:a.assignedCrews,Predecessors:a.predecessors.join(', '),Critical:a.critical,SourceElementIDs:(a.sourceElementIds??project.elements.filter(e=>e.kind===a.category).map(e=>e.id)).join(', '),QuantityMode:a.quantityMode??'legacy/manual',ProductivityMode:a.productivityMode??'manual',MinimumDuration:a.minDuration,LeadTimeCalendarDays:a.leadTime,FixedDuration:a.fixedDuration??'',Formula:a.fixedDuration!==undefined?`Fixed ${a.fixedDuration} working days`:`max(1, ceil(minimum ${a.minDuration}), ceil(${a.quantity} / ${a.productivity})) before calendar/resource/dependency limits`})),
  'Assumptions':[{Note:'All geometry stored in metres. Quantities use the documented engine measurement rules.'},{Note:'Estimate maturity: preliminary. Sample rates are illustrative, not supplier quotations.'},{Note:'Unmodelled work is represented through explicit allowances and planning activities.'},{Note:`Explicit non-working holidays: ${(project.schedule.holidays??[]).join(', ')||'None entered'}`},...cost.issues.map(Note=>({Note})),...schedule.issues.map(Note=>({Note})),...schedules.issues.map(Note=>({Note}))],
 };
 if(project.planning){const review=assessPlanning(project);sheets['Site checks']=review.checks.map(c=>({ProjectVersion:project.version,Check:c.label,ModelMeasurement:c.actual,EnteredLimit:c.limit,Unit:c.unit,Result:c.status,Clause:c.clause,Explanation:c.message,Source:review.source?.url??'',SourceVersion:review.source?.version??'',Jurisdiction:Object.values(review.jurisdiction).join(', '),SourceIssues:review.sourceIssues.join('; '),Disclaimer:review.disclaimer}));sheets['Assumptions'].push(...review.coverageGaps.map(Note=>({Note})),...review.measurementNotes.map(Note=>({Note})),{Note:review.disclaimer});sheets['Vaastu preferences']=review.vaastu.map(c=>({ProjectVersion:project.version,ElementIDs:c.elementIds.join(', '),Name:c.label,MeasuredSector:c.sector??'Unknown',SelectedSectors:c.preferred.join(', '),Result:c.status,Explanation:c.message}));}
 for(const [name,rows] of Object.entries(sheets)){const sanitized=rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,safeCell(v)])));const ws=XLSX.utils.json_to_sheet(sanitized);ws['!cols']=Object.keys(rows[0]||{Value:1}).map(()=>({wch:25}));XLSX.utils.book_append_sheet(wb,ws,name);}
 return wb;
}
export function exportWorkbook(project:Project,quantityLines:QuantityLine[],cost:CostResult,schedule:ScheduleResult){recordUsage('document_exported');XLSX.writeFile(buildWorkbook(project,quantityLines,cost,schedule),`${slug(project)}-v${project.version}.xlsx`);}
export function buildSchedulesCsv(project:Project,kind:'rooms'|'doors'|'windows'|'all'='all'):string {
 const schedules=modelSchedules(project),quote=(value:unknown)=>`"${String(safeCell(value)??'').replaceAll('"','""')}"`;
 const rows:unknown[][]=[['Project',project.name,'Version',project.version,'Updated',project.updatedAt,'Geometry units','m'],['Class','Element ID','External ID','Mark / number','Name','Level','Type','Material','Width (m)','Depth (m)','Height (m)','Area (m²)','Sill (m)','Use','Finish','Fire rating','Host ID','Classification','Specification','Issues']];
 if(kind==='rooms'||kind==='all')for(const row of schedules.rooms)rows.push(['room',row.elementId,row.externalId,row.number,row.name,row.level,row.typeName,row.material,row.width,row.depth,'',row.area,'',row.use,row.finish,'','',row.classification,row.specification,row.issues.join('; ')]);
 for(const group of ['doors','windows']as const)if(kind===group||kind==='all')for(const row of schedules[group])rows.push([group==='doors'?'door':'window',row.elementId,row.externalId,row.mark,row.name,row.level,row.typeName,row.material,row.width,'',row.height,'',row.sillHeight,'','',row.fireRating,row.hostId,row.classification,row.specification,row.issues.join('; ')]);
 return rows.map(row=>row.map(quote).join(',')).join('\r\n');
}
export function exportModelSchedulesCsv(project:Project,kind:'rooms'|'doors'|'windows'|'all'='all'){recordUsage('document_exported');downloadFile(`${slug(project)}-${kind==='all'?'model-schedules':kind}-v${project.version}.csv`,buildSchedulesCsv(project,kind),'text/csv;charset=utf-8');}
export function exportCsv(project:Project,quantityLines:QuantityLine[]){recordUsage('document_exported');const quote=(v:unknown)=>`"${String(safeCell(v)??'').replaceAll('"','""')}"`;downloadFile(`${slug(project)}-quantities-v${project.version}.csv`,[['Project',project.name,'Version',project.version],['Element','Name','Class','Quantity','Unit','Measurement rule'],...quantityLines.map(q=>[q.elementId,q.name,q.kind,q.quantity,q.unit,q.formula])].map(r=>r.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8');}
export function exportDecision(project:Project,cost:CostResult,schedule:ScheduleResult,scenarios:Scenario[],objective:string){recordUsage('document_exported');downloadFile(`${slug(project)}-decision-v${project.version}.json`,JSON.stringify({schemaVersion:1,calculationVersions,project:{id:project.id,name:project.name,version:project.version,units:project.units,currency:project.currency},exportedAt:new Date().toISOString(),maturity:'Preliminary',objective,measurementRule:'Net wall face area deducts the clipped union of hosted openings; slabs/roofs plan area; unit components counted',modelSchedules:modelSchedules(project),assumptions:{rates:project.types,allowances:project.allowances,schedule:project.schedule,constraints:project.constraints,planning:project.planning},siteChecks:project.planning?assessPlanning(project):undefined,baseline:{cost,schedule},scenarios,audit:project.audit},null,2),'application/json');}
const pdfText=(value:unknown)=>String(value??'').replaceAll('²','2').replaceAll('³','3').replaceAll('×',' x ').replaceAll('÷',' / ').replaceAll('→',' -> ').replaceAll('≤','<=').replaceAll('≥','>=').replaceAll('−','-').replace(/[–—]/g,'-').replaceAll('·',' / ').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\x7e\n]/g,'?');
const objectiveName=(value:string)=>({baseline:'Baseline review',cost:'Lowest estimated cost within the deadline',time:'Earliest estimated completion within budget',tradeoffs:'Cost and construction-time trade-offs'}[value]??value);

/** Construct a vector report independently of browser download APIs, for review and QA. */
export function buildReviewPdf(project:Project,cost:CostResult,schedule:ScheduleResult,quantityLines:QuantityLine[],scenarios:Scenario[]=[],objective='baseline'){
 const doc=new jsPDF({unit:'mm',format:'a4'}),generatedAt=new Date().toISOString(),modelTables=modelSchedules(project);let y=55,pageTitle='Project review';
 const ink='#292b36',muted='#7c7b88',purple='#6e5acb';
 const money=(value:number|null,currency=project.currency)=>value===null?'UNPRICED':`${currency} ${Math.round(value).toLocaleString('en-US')}`;
 doc.setProperties({title:`${project.name} - project review v${project.version}`,subject:`Preliminary BIM review; ${objectiveName(objective)}`,author:'Atelier BIM',creator:'Atelier BIM local workspace'});
 function header(title:string,landscape=false){
  pageTitle=title;const width=doc.internal.pageSize.getWidth();doc.setFont('helvetica','normal');doc.setTextColor(purple);doc.setFontSize(9);doc.text('ATELIER  /  COORDINATED PROJECT REVIEW',18,14);doc.setDrawColor('#dedce5');doc.setLineWidth(.2);doc.line(18,19,width-18,19);
  doc.setTextColor(ink);doc.setFontSize(landscape?20:21);const heading=doc.splitTextToSize(pdfText(title),width-36);doc.text(heading.slice(0,2),18,30);
  const metaY=heading.length>1?43:38;doc.setFontSize(8);doc.setTextColor(muted);doc.text(pdfText(`v${project.version} | Display: ${project.units} | Geometry: m | ${project.currency} | PRELIMINARY`),18,metaY);doc.text(pdfText(`Objective: ${objectiveName(objective)}`).slice(0,landscape?150:110),18,metaY+5);y=Math.max(55,metaY+13);
 }
 function newPage(title:string,landscape=false){doc.addPage('a4',landscape?'landscape':'portrait');header(title,landscape);}
 function paragraph(value:string,size=9){
  doc.setFontSize(size);const lines:string[]=doc.splitTextToSize(pdfText(value),174);
  if(lines.length*4.5<210&&y+lines.length*4.5>276)newPage(`${pageTitle} (continued)`);
  for(const text of lines){if(y>274)newPage(`${pageTitle} (continued)`);doc.setFontSize(size);doc.setTextColor(ink);doc.text(text,18,y);y+=4.5;}y+=3;
 }
 function section(title:string){if(y>258)newPage(title);doc.setFontSize(12);doc.setTextColor(ink);doc.text(pdfText(title),18,y);y+=8;}
 function table(title:string,columns:{label:string;width:number}[],rows:unknown[][]){
  doc.setFontSize(7.7);
  const estimatedHeight=21+rows.reduce<number>((height,row)=>height+Math.max(1,...columns.map((column,i)=>Math.min(12,doc.splitTextToSize(pdfText(row[i]),column.width-4).length)))*3.5+4,0);
  if(estimatedHeight<210&&y+estimatedHeight>276)newPage(title);else section(title);
  function headings(){let x=18;doc.setFillColor('#f0edf8');doc.rect(18,y-4,174,8,'F');doc.setFontSize(7.5);doc.setTextColor('#655b85');for(const column of columns){doc.text(pdfText(column.label),x+2,y+1);x+=column.width;}y+=8;}
  headings();
  for(const row of rows){
   const cells=columns.map((column,i)=>{doc.setFontSize(7.7);const wrapped:string[]=doc.splitTextToSize(pdfText(row[i]),column.width-4);return wrapped.length>12?[...wrapped.slice(0,11),`${wrapped[11].slice(0,-3)}...`]:wrapped;});
   const height=Math.max(1,...cells.map(c=>c.length))*3.5+4;
   if(y+height>276){newPage(`${title} (continued)`);headings();}
   let x=18;doc.setFontSize(7.7);doc.setTextColor(ink);cells.forEach((cell,i)=>{doc.text(cell,x+2,y+1);x+=columns[i].width;});y+=height;doc.setDrawColor('#e9e7ec');doc.setLineWidth(.15);doc.line(18,y-2,192,y-2);
  }
  if(!rows.length){doc.setFontSize(9);doc.setTextColor(muted);doc.text('No entries in the current model.',20,y+1);y+=9;}y+=5;
 }
 function drawingSheet(drawing:DrawingData,sheetNumber:string){
  newPage(drawing.title,true);const pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight();
  const area={x:23,y:y+4,width:pageWidth-46,height:pageHeight-y-40};
  if(drawing.empty){doc.setFontSize(12);doc.setTextColor(muted);doc.text('No model elements on this view.',pageWidth/2,area.y+area.height/2,{align:'center'});}
  else{
   const bounds=drawing.bounds,bw=Math.max(.1,bounds.maxX-bounds.minX),bh=Math.max(.1,bounds.maxY-bounds.minY),scale=Math.min(area.width/bw,area.height/bh);
   const ox=area.x+(area.width-bw*scale)/2-bounds.minX*scale,oy=area.y+(area.height-bh*scale)/2-bounds.minY*scale;
   for(const primitive of drawing.primitives){
    const points=primitive.points.map(p=>({x:ox+p.x*scale,y:oy+p.y*scale}));if(!points.length)continue;
    if(primitive.kind==='text'){doc.setFont('helvetica','normal');doc.setFontSize(Math.max(5,Math.min(9,(primitive.fontSize??.2)*scale*72/25.4)));doc.setTextColor(primitive.stroke);doc.text(pdfText(primitive.text),points[0].x,points[0].y,{align:primitive.anchor==='middle'?'center':primitive.anchor==='end'?'right':'left'});continue;}
    const stroke=primitive.stroke!=='none',fill=!!primitive.fill&&primitive.fill!=='none';if(!stroke&&!fill)continue;
    doc.setDrawColor(stroke?primitive.stroke:'#ffffff');if(fill)doc.setFillColor(primitive.fill!);doc.setLineWidth(Math.max(.12,Math.min(.55,(primitive.width??.02)*scale)));doc.setLineDashPattern(primitive.dashed?[1.1,.8]:[],0);
    const deltas=points.slice(1).map((p,i)=>[p.x-points[i].x,p.y-points[i].y]);doc.lines(deltas,points[0].x,points[0].y,[1,1],primitive.kind==='polygon'?(fill?(stroke?'FD':'F'):'S'):'S',primitive.kind==='polygon');
   }
   doc.setLineDashPattern([],0);
  }
  doc.setFontSize(8);doc.setTextColor(muted);doc.text(pdfText(drawing.subtitle),18,pageHeight-27);doc.text(pdfText(`${sheetNumber} | ${drawing.elementCount} source elements | Fit to sheet; dimensions govern. Not for construction.`),18,pageHeight-22);
 }
 header(project.name);
 paragraph(project.description||'Architectural project review generated from the current BIM model.',10);
 const stats=[['Known estimated scope',money(cost.total)],['Construction window',schedule.feasible?`${schedule.durationDays} calendar days`:'Unresolved / review activities'],['Priced-scope completeness',`${Math.round(cost.completeness)}%`],['Model contents',`${project.elements.length} elements / ${project.levels.length} levels`]];
 stats.forEach(([label,value],i)=>{const x=i%2?108:18,rowY=y+Math.floor(i/2)*26;doc.setFillColor('#f6f5f8');doc.roundedRect(x,rowY,84,22,2,2,'F');doc.setFontSize(8);doc.setTextColor(muted);doc.text(label,x+5,rowY+7);doc.setFontSize(12);doc.setTextColor(ink);doc.text(pdfText(value),x+5,rowY+15);});y+=59;
 paragraph(schedule.feasible?`Baseline schedule: ${schedule.startDate} to ${schedule.finishDate}. Feasible under the supplied planning inputs.`:'Baseline schedule is unresolved. No completion date or time saving is established until the activity scope and scheduling issues are resolved.');
 paragraph('Maturity: preliminary architectural review. Model geometry, rate inputs, unmodelled allowances, productivity and resource assumptions require project-team confirmation before construction decisions.');
 section('Source and provenance');
 paragraph(`Project ID: ${project.id}\nSource revision: ${project.version}\nSource last updated: ${project.updatedAt}\nReport generated (UTC): ${generatedAt}\nImported identifiers retained: ${project.elements.filter(e=>e.externalId).length} elements\nRate provenance: component-rate records retain stated dates, optional source references and explicit currencies. Missing sources remain flagged.`);
 paragraph(`Calculation versions: ${Object.entries(calculationVersions).map(([engine,version])=>`${engine}: ${version}`).join('; ')}.`,8);
 paragraph('Drawing dimensions follow the project display units. Quantity and estimate tables retain their explicit measurement-rule units (m2, m3, m or ea). Geometry is stored in metres. Drawings show the supported rectangular BIM geometry, including actual levels and rotated components.');
 paragraph('Plans are provided for every project level, followed by geometric section and elevation overviews. Engineering detailing, reinforcement and regulatory certification are outside this review package. Long table text may be abbreviated; use the workbook and decision JSON for full inputs.',8);
 if(project.planning){const review=assessPlanning(project);newPage('Site and preference review');paragraph(review.disclaimer);paragraph(`Jurisdiction: ${[review.jurisdiction.authority,review.jurisdiction.region,review.jurisdiction.country].filter(Boolean).join(', ')||'Unconfigured'}. Source: ${review.source?.title||'Unconfigured'} / ${review.source?.version||'unconfirmed'}.`);paragraph(`Source URL: ${review.source?.url||'None'}\nSource issues: ${review.sourceIssues.join('; ')||'Team-entered source metadata is complete; legal authority and applicability remain subject to professional review.'}`);table('Entered geometric limits',[{label:'Check',width:42},{label:'Model / entered limit',width:32},{label:'Result',width:40},{label:'Clause',width:60}],review.checks.map(c=>[c.label,`${c.actual??'Unknown'} / ${c.limit??'Unknown'} ${c.unit}`,c.status,c.clause]));if(review.vaastu.length)table('Client-selected Vaastu preferences',[{label:'Element',width:42},{label:'Sector',width:22},{label:'Preference result',width:48},{label:'Explanation',width:62}],review.vaastu.map(c=>[c.label,c.sector??'Unknown',c.status,c.message]));paragraph('Unevaluated: local zoning and road/building lines; statutory area definitions and exemptions; fire/egress, accessibility and parking; structural design, services and pool safety; overlays, easements and permits. Check amendments after the dated source. Full measurement notes and coverage gaps are retained in the site-check JSON and workbook.',8);}
 [...project.levels].sort((a,b)=>a.elevation-b.elevation).forEach((level,index)=>drawingSheet(createPlanDrawing(project,level.id),`A-${String(index+1).padStart(3,'0')}`));
 drawingSheet(createProjectionDrawing(project,'section'),'A-201');drawingSheet(createProjectionDrawing(project,'elevation'),'A-301');
 newPage('Room, door and window schedules');
 paragraph('Rows below retain model element IDs and current source revision. Dimensions and areas in these schedules use canonical metres and square metres; missing classifications and specifications remain visible.');
 table('Room schedule',[{label:'Room / source ID',width:45},{label:'Level',width:23},{label:'Area m2',width:18},{label:'Use / finish',width:46},{label:'Issues',width:42}],modelTables.rooms.map(row=>[`${row.number?`${row.number} / `:''}${row.name}\n${row.elementId}`,row.level,row.area.toFixed(2),`${row.use||'Use unspecified'}\n${row.finish||'Finish unspecified'}`,row.issues.join('; ')||'None']));
 const openingColumns=[{label:'Mark / source ID',width:39},{label:'Level / type',width:37},{label:'Size / sill (m)',width:29},{label:'Host / material',width:37},{label:'Fire / specification',width:32}];
 for(const [title,rows]of [['Door schedule',modelTables.doors],['Window schedule',modelTables.windows]]as const)table(title,openingColumns,rows.map(row=>[`${row.mark}\n${row.elementId}`,`${row.level}\n${row.typeName}`,`${row.width.toFixed(2)} x ${row.height.toFixed(2)}\nSill ${row.sillHeight.toFixed(2)}`,`${row.hostName}\n${row.material||'Unspecified'}`,`${row.fireRating||'Fire rating unspecified'}\n${row.specification||'Specification unspecified'}`]));
 if(modelTables.issues.length)table('Missing model-schedule information',[{label:'Source and issue',width:174}],modelTables.issues.map(issue=>[issue]));
 newPage('Measured quantities');
 table('Model quantity schedule',[{label:'Element / name',width:47},{label:'Class',width:18},{label:'Quantity',width:18},{label:'Unit',width:13},{label:'Measurement rule',width:78}],quantityLines.map(q=>[`${q.name}\n${q.elementId}`,q.kind,q.quantity.toFixed(2),q.unit,q.formula]));
 table('Explicit unmodelled allowances',[{label:'Allowance',width:95},{label:'Included',width:24},{label:'Amount',width:55}],project.allowances.map(a=>[a.name,a.included?'Yes':'No',money(a.amount)]));
 newPage('Cost inputs and estimate');
 paragraph(`Known subtotal: ${money(cost.total)}. Completeness: ${Math.round(cost.completeness)}%. Unknown rates remain unpriced and are not assumed to be zero.`);
 table('Priced scope',[{label:'Item',width:50},{label:'Quantity',width:18},{label:'Unit',width:22},{label:'Known total',width:31},{label:'Issues / source date',width:53}],cost.lines.map(l=>[l.name,l.quantity.toFixed(2),l.unit,money(l.total),`${l.rateDate||'Rate date not supplied'}${l.issues.length?`\n${l.issues.join('; ')}`:''}`]));
 table('Component rate provenance',[{label:'Component type',width:52},{label:'Unit',width:12},{label:'Material',width:27},{label:'Labour',width:27},{label:'Equipment',width:27},{label:'Rate date',width:29}],project.types.filter(t=>t.kind!=='room').map(t=>[`${t.name}\n${t.id}`,t.unit,money(t.materialRate,t.rateCurrency??project.currency),money(t.labourRate,t.rateCurrency??project.currency),money(t.equipmentRate,t.rateCurrency??project.currency),t.rateDate||'Unspecified']));
 table('Recorded rate currencies and sources',[{label:'Component type',width:58},{label:'Rate currency',width:28},{label:'Source reference',width:88}],project.types.filter(type=>type.kind!=='room').map(type=>[type.name,type.rateCurrency??`${project.currency} (assumed)`,type.rateSource||'Not supplied; review required']));
 newPage('Construction and decisions');
 paragraph(`Objective: ${objectiveName(objective)}. Activities use working calendars, dependencies, constrained crews and procurement inputs. Activity durations are working days; project duration is calendar days.`);
 table('Construction activity schedule',[{label:'Activity',width:52},{label:'Start',width:24},{label:'Finish',width:24},{label:'Work days',width:21},{label:'Crews',width:15},{label:'Critical',width:18},{label:'Qty / unit',width:20}],schedule.activities.map(a=>[a.name,a.startDate,a.finishDate,a.duration,a.assignedCrews,a.critical?'Yes':'No',`${a.quantity.toFixed(2)} ${a.unit}`]));
 if(scenarios.length)table('Compared construction scenarios',[{label:'Scenario',width:39},{label:'Known cost',width:31},{label:'Calendar days',width:24},{label:'Feasible',width:19},{label:'Changes and constraints',width:61}],scenarios.map(s=>[s.name,money(s.cost.total),s.schedule.feasible?s.schedule.durationDays:'Unresolved',s.feasible?'Yes':'No',[...s.changes,...s.reasons].join('; ')]));
 else paragraph('No alternative scenarios were attached to this export. This package reports the current baseline.');
 section('Assumptions and unresolved scope');
 const issues=[...new Set([...cost.issues,...schedule.issues])];if(issues.length)issues.forEach(issue=>paragraph(`- ${issue}`,8.5));else paragraph('No unresolved issues were returned by the current deterministic cost and schedule engines.');
 paragraph(`Planning capacity: ${project.schedule.crews} crews; project maximum ${project.constraints.maxCrews}. Procurement allowance: ${project.schedule.procurementDays} days. Working weekdays: ${project.schedule.workingDays.join(', ')} (0 = Sunday).`);
 paragraph(`Non-working holiday exceptions: ${(project.schedule.holidays??[]).join(', ')||'None entered'}.`);
 for(let page=1;page<=doc.getNumberOfPages();page++){doc.setPage(page);const w=doc.internal.pageSize.getWidth(),h=doc.internal.pageSize.getHeight();doc.setDrawColor('#e2e0e7');doc.setLineWidth(.2);doc.line(18,h-16,w-18,h-16);doc.setTextColor(muted);doc.setFontSize(7.5);doc.text(pdfText(`${project.name} | v${project.version} | Preliminary`).slice(0,105),18,h-10);doc.text(`${page} / ${doc.getNumberOfPages()}`,w-18,h-10,{align:'right'});}
 return doc;
}
export function exportPdf(project:Project,cost:CostResult,schedule:ScheduleResult,quantityLines:QuantityLine[],scenarios:Scenario[]=[],objective='baseline'){recordUsage('document_exported');
 buildReviewPdf(project,cost,schedule,quantityLines,scenarios,objective).save(`${slug(project)}-review-v${project.version}.pdf`);
}
