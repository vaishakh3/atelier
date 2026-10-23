/** Reproducible synthetic low-rise engine benchmark: npx tsx tests/benchmark.ts */
import { performance } from 'node:perf_hooks';
import { createDemoProject } from '../src/domain/seed';
import type { Project,Scenario } from '../src/domain/types';
import { quantities,estimate,buildSchedule,compareRevisions,compareScenarios,sequenceBaselineSignature } from '../src/engine';
import { modelSchedules } from '../src/model/schedules';
import { exportIfc,importIfc } from '../src/io/ifc';

function fixture(count:number):Project {
 const project=createDemoProject(),source=structuredClone(project.elements);project.elements=[];
 for(let copy=0;project.elements.length<count;copy++){
  for(const original of source){if(project.elements.length>=count)break;const element=structuredClone(original);element.id=`wing-${copy}-${original.id}`;delete element.externalId;if(element.hostId)element.hostId=`wing-${copy}-${element.hostId}`;element.x+=18*(copy%10);element.y+=15*Math.floor(copy/10);project.elements.push(element);}
 }
 for(const allowance of project.allowances)if(allowance.amount===null)allowance.amount=0;
 return project;
}
function measure(task:()=>unknown,repetitions=5){task();const times:number[]=[];for(let i=0;i<repetitions;i++){const start=performance.now();task();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return{medianMs:+times[Math.floor(times.length/2)].toFixed(2),p95Ms:+times[Math.ceil(times.length*.95)-1].toFixed(2),samples:times.length};}
function measureScenarios(project:Project,withSequences:boolean){
 const input=structuredClone(project);
 if(withSequences){
  const baselineSignature=sequenceBaselineSignature(input);
  // Add constraints only. These are synthetic timing inputs, not planner-approved construction methods.
  const dependencies:Record<string,string[]>[]=[{openings:['walls','mep']},{doors:['walls','mep']},{roof:['walls','openings']},{mep:['walls','openings']},{mep:['walls','doors']},{doors:['walls','openings']}];
  input.schedule.sequenceAlternatives=dependencies.map((predecessors,index)=>({id:`benchmark-sequence-${index+1}`,name:`Synthetic dependency variant ${index+1}`,approved:true,rationale:'Synthetic benchmark input only: adds an explicit dependency for scalability measurement, not construction-method validation.',baselineSignature,predecessors}));
 }
 let last:Scenario[]=[];
 const timing=measure(()=>{last=compareScenarios(input,'tradeoffs');},3);
 return{...timing,approvedVariants:input.schedule.sequenceAlternatives?.length??0,search:last[0]?.searchInfo,returnedScenarios:last.length};
}
const results=[];
for(const count of [1500,3000]){
 const project=fixture(count),revised=structuredClone(project);revised.version++;revised.elements[0].width+=.5;
 if(process.argv.includes('--scenarios-only')){
  results.push({elements:count,source:'Synthetic repetitions of the two-storey demonstration; not a real-world acceptance corpus',node:process.version,platform:`${process.platform}-${process.arch}`,noSequenceVariants:measureScenarios(project,false),sixApprovedSequenceVariants:measureScenarios(project,true)});
  continue;
 }
 const quantity=quantities(project),schedule=buildSchedule(project),ifc=exportIfc(project);
 results.push({elements:count,source:'Synthetic repetitions of the two-storey demonstration; not a real-world acceptance corpus',node:process.version,platform:`${process.platform}-${process.arch}`,quantities:measure(()=>quantities(project)),estimate:measure(()=>estimate(project,schedule)),schedule:measure(()=>buildSchedule(project)),modelSchedules:measure(()=>modelSchedules(project)),revisionComparison:measure(()=>compareRevisions(project,revised)),ifcBytes:Buffer.byteLength(ifc),ifcExport:measure(()=>exportIfc(project),3),ifcImport:measure(()=>importIfc(ifc,project),3),quantityRows:quantity.length,scheduleFeasible:schedule.feasible});
}
console.log(JSON.stringify(results,null,2));
