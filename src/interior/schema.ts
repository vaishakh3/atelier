import {z} from 'zod';
import {FURNITURE_CATALOG,INTERIOR_STYLES} from './catalog';
const id=z.string().trim().min(1).max(160);
const styleId=z.string().refine(value=>INTERIOR_STYLES.some(style=>style.id===value),'Choose a supported interior style.');
const finite=z.number().finite();
export const furniturePlacementSchema=z.object({id,assetId:id.refine(value=>FURNITURE_CATALOG.some(asset=>asset.id===value),'Furniture must have a catalog source.'),roomId:id,levelId:id,x:finite.min(-100000).max(100000),y:finite.min(-100000).max(100000),rotation:finite.min(-36000).max(36000)}).strict();
/** Bounded raster references only. Never accept SVG, remote URLs or arbitrary HTML. */
export function validInteriorImage(value:string):boolean {
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);if(!match||match[2].length%4!==0||match[2].length>1398104)return false;
 const body=match[2];if(match[1]==='png')return body.startsWith('iVBORw0KGgo');if(match[1]==='jpeg')return body.startsWith('/9j/');
 // RIFF....WEBP: magic bytes are checked without decoding the full image.
 try{const prefix=atob(body.slice(0,32));return prefix.startsWith('RIFF')&&prefix.slice(8,12)==='WEBP';}catch{return false;}
}
export const interiorReferenceSchema=z.object({id,name:z.string().trim().min(1).max(160),styleId,dataUrl:z.string().max(1398200).refine(validInteriorImage,'Use a PNG, JPEG or WebP image no larger than 1 MiB.')}).strict();
export const interiorStateSchema=z.object({schemaVersion:z.literal(1),styleId,placements:z.array(furniturePlacementSchema).max(500),references:z.array(interiorReferenceSchema).max(4)}).strict().superRefine((state,ctx)=>{for(const key of ['placements','references'] as const){const ids=new Set<string>();state[key].forEach((item,index)=>{if(ids.has(item.id))ctx.addIssue({code:'custom',path:[key,index,'id'],message:'IDs must be unique.'});ids.add(item.id);});}});
