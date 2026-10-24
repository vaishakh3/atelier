import type {AiProposal, LayoutProposal, Project} from './types';
import {previewLayout} from './layout';
import type {LayoutPreview} from './layout';
import {applyProposal} from './transactions';

export type LayoutVariant = 'balanced' | 'compact' | 'daylight';
export interface LayoutAlternative {
 id:string;
 variant:LayoutVariant;
 label:string;
 description:string;
 proposal:AiProposal;
 preview:Project;
 result:LayoutPreview;
}
export interface LayoutAlternatives { alternatives:LayoutAlternative[]; notes:string[] }
const variants:LayoutVariant[]=['balanced','compact','daylight'];
const descriptions:Record<LayoutVariant,{label:string;description:string}>={
 balanced:{label:'Balanced',description:'Balances room proportions, shared circulation and exterior openings.'},
 compact:{label:'Compact',description:'Gives envelope size more weight in the bounded search. Compare the resulting dimensions.'},
 daylight:{label:'Window priority',description:'Prefers shallower rooms and exterior exposure. Window provision is a geometric proxy.'},
};

/** Compare physical creations, not generated IDs or variant provenance. */
function geometryKey(source:Project,result:LayoutPreview):string {
 const levels=new Map([...source.levels,...result.levels].map(level=>[level.id,level.elevation]));
 const shape=(element:LayoutPreview['elements'][number])=>[element.kind,element.kind==='room'?[element.name,element.properties.use]:null,levels.get(element.levelId),element.x,element.y,element.z,element.width,element.depth,element.height,element.rotation,element.typeId,element.material];
 const elements=new Map([...source.elements,...result.elements].map(element=>[element.id,element]));
 const shapes=result.elements.map(element=>JSON.stringify([...shape(element),element.hostId&&elements.has(element.hostId)?shape(elements.get(element.hostId)!):null])).sort();
 return JSON.stringify({levels:result.levels.map(level=>level.elevation).sort((a,b)=>a-b),shapes});
}

/**
 * One provider programme, up to three locally generated, independently validated choices.
 * Neither the selected footprint, room programme nor explicit floor placement is changed.
 * Every choice remains an ordinary layout proposal, checked again by applyProposal on acceptance.
 */
export function generateLayoutAlternatives(source:Project,original:AiProposal):LayoutAlternatives {
 if(original.kind!=='layout')return{alternatives:[],notes:[]};
 if(!original.layout)throw new Error('The layout specification is missing. Generate a new proposal.');
 // Validate the exact response first; a malformed provider response must not be repaired silently.
 const firstPreview=applyProposal(source,original),firstResult=previewLayout(source,original.layout);
 const initial:LayoutVariant=original.layout.variant??'balanced';
 const alternatives:LayoutAlternative[]=[{id:original.id,variant:initial,...descriptions[initial],proposal:original,preview:firstPreview,result:firstResult}];
 const seen=new Map([[geometryKey(source,firstResult),descriptions[initial].label]]),notes:string[]=[];
 for(const variant of variants.filter(variant=>variant!==initial)){
  try{
   const id=`${original.id.slice(0,48)}-${variant}`;
   const layout:LayoutProposal={...structuredClone(original.layout),idPrefix:id,variant};
   const result=previewLayout(source,layout);
   if(result.issues.length)throw new Error(result.issues.join(' '));
   const previous=seen.get(geometryKey(source,result));
   if(previous){notes.push(`${descriptions[variant].label} produces the same physical arrangement as ${previous} within the current constraints; it is shown once.`);continue;}
   const floorCount=result.floors.length;
   const proposal:AiProposal={...structuredClone(original),id,layout,summary:`${result.removedElements.length?'Replan':'Create'} a ${floorCount}-storey ${descriptions[variant].label.toLowerCase()} concept with ${layout.rooms.length} requested spaces, ${result.elements.length} new BIM elements${result.removedElements.length?` and ${result.removedElements.length} replaced concept elements`:''}${result.levels.length?`; add ${result.levels.length} level`:''}`,issues:[...new Set(result.assumptions)],creations:result.elements.map(after=>({elementId:after.id,before:null,after})),levelCreations:result.levels.map(after=>({levelId:after.id,before:null,after})),removals:result.removedElements.map(before=>({elementId:before.id,before,after:null}))};
   const preview=applyProposal(source,proposal);
   alternatives.push({id,variant,...descriptions[variant],proposal,preview,result});seen.set(geometryKey(source,result),descriptions[variant].label);
  }catch(error){notes.push(`${descriptions[variant].label} is unavailable for this programme and footprint. ${error instanceof Error?error.message:'The local geometry checks did not pass.'}`);}
 }
 return{alternatives,notes};
}
