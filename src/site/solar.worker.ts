import {analyseSunHours} from './solar';
import type {Project} from '../domain/types';
import type {SiteContext,SiteVector} from './types';
self.onmessage=(event:MessageEvent<{project:Pick<Project,'elements'>;site:SiteContext;date:string;points:SiteVector[];step:number}>)=>{try{const {project,site,date,points,step}=event.data;self.postMessage({result:analyseSunHours(project,site,date,points,step)});}catch(reason){self.postMessage({error:reason instanceof Error?reason.message:'The direct-sun analysis failed.'});}};
