import type {LayoutProposal,Project,Role} from '../domain/types';
import {previewLayout} from '../domain/layout';
import {createServicePlan} from './model';

/** A reviewable, deterministic example, available only in an empty project. */
export function createServicesDemoProject(project:Project):Project {
 if(project.elements.length||project.services)throw new Error('Create an empty project to preview the services demonstration. Existing designs are never replaced.');
 if(project.constraints.lockedElementIds.length||project.constraints.lockedProperties.length)throw new Error('The example cannot change a locked project.');
 const room=(key:string,name:string,use:LayoutProposal['rooms'][number]['use'],floor:0|1,area:number)=>({key,name,use,floor,area,attachedTo:null});
 const request:LayoutProposal={levelId:project.levels[0].id,footprintId:null,idPrefix:'services-house',baselineVersion:project.version,width:null,depth:null,storeys:2,floorHeight:3.2,variant:'balanced',rooms:[
  room('living','Living room','living',0,22),room('dining','Dining room','dining',0,12),room('kitchen','Kitchen','kitchen',0,10),
  room('bed-guest','Guest bedroom','bedroom',0,14),room('bath-ground','Ground bathroom','bathroom',0,5),room('utility-ground','Laundry','utility',0,5),
  room('bed-main','Main bedroom','bedroom',1,16),room('bed-2','Bedroom 2','bedroom',1,14),room('bed-3','Bedroom 3','bedroom',1,14),
  room('bath-upper','Upper bathroom','bathroom',1,5),room('utility-upper','Upper utility','utility',1,5),room('study','Study','study',1,8),
 ]};
 const layout=previewLayout(project,request);
 if(layout.issues.length)throw new Error(layout.issues.join(' '));
 const candidate:Project={...structuredClone(project),elements:layout.elements,levels:[...project.levels,...layout.levels],description:'Services coordination demonstration · two-storey, four-bedroom concept. Shell and services require professional review.',
  // Do not count the same illustrative MEP allowance and the new measured service scope.
  allowances:project.allowances.map(a=>a.id==='a-mep'?{...a,included:false}:a),schedule:{...project.schedule,activities:[],sequenceAlternatives:[],modelReview:undefined,modelReviewRequired:true}};
 return {...candidate,services:createServicePlan(candidate)};
}

/** Dedicated empty-project demo acceptance, separate from the narrower services editor. */
export function acceptServicesDemoProject(project:Project,baselineSnapshot:string,candidate:Project,role:Role):Project {
 if(role!=='admin'&&role!=='editor')throw new Error('Only an editor or administrator can create the demonstration.');
 if(JSON.stringify(project)!==baselineSnapshot)throw new Error('The project changed. Discard the demonstration preview and prepare it again.');
 const expected=createServicesDemoProject(project);
 if(JSON.stringify(candidate)!==JSON.stringify(expected))throw new Error('The demonstration changed after preview. Discard it and prepare it again.');
 return structuredClone(expected);
}
