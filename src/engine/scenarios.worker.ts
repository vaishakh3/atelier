import {compareScenarios} from './scenarios';
import type {Objective,Project,Scenario} from '../domain/types';
const worker=self as unknown as {onmessage:((event:MessageEvent<{project:Project;objective:Objective}>)=>void)|null;postMessage:(value:{results?:Scenario[];error?:string})=>void};
worker.onmessage=event=>{try{worker.postMessage({results:compareScenarios(event.data.project,event.data.objective)});}catch{worker.postMessage({error:'The scenario inputs could not be evaluated. Check the model and activity network before trying again.'});}};
