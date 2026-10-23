import {z} from 'zod';
import {projectSchema} from './schema';
import type {SavedVersion,ReviewComment} from './types';
const snapshotSchema=z.object({id:z.string().min(1).max(160),label:z.string().max(3000),actor:z.string().max(3000),timestamp:z.string().max(100),project:projectSchema}).strict();
const commentSchema=z.object({id:z.string().max(160),versionId:z.string().max(160),author:z.string().max(3000),text:z.string().max(4000),createdAt:z.string().max(100),authorId:z.string().max(160).optional(),role:z.enum(['admin','editor','contributor','reviewer']).optional()}).strict();
const schema=z.object({format:z.literal('atelier-review'),schemaVersion:z.literal(1),createdAt:z.string().max(100),snapshot:snapshotSchema,comments:z.array(commentSchema).max(10000),checksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ReadonlyReviewPackage=z.infer<typeof schema>;
function stable(value:unknown):string{if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+stable(item)).join(',')+'}';return JSON.stringify(value)??'null';}
async function checksum(value:unknown){const bytes=new TextEncoder().encode(stable(value));const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function createReviewPackage(snapshot:SavedVersion,comments:ReviewComment[]):Promise<ReadonlyReviewPackage>{
 const content={format:'atelier-review' as const,schemaVersion:1 as const,createdAt:new Date().toISOString(),snapshot:structuredClone(snapshot),comments:structuredClone(comments.filter(comment=>comment.versionId===snapshot.id))};
 const parsed=schema.omit({checksum:true}).parse(content);return {...parsed,checksum:await checksum(parsed)};
}
export async function readReviewPackage(input:unknown):Promise<ReadonlyReviewPackage>{
 const parsed=schema.parse(input);const {checksum:expected,...content}=parsed;
 if(parsed.comments.some(comment=>comment.versionId!==parsed.snapshot.id))throw new Error('Review comments must reference this snapshot.');
 if(await checksum(content)!==expected)throw new Error('The review file integrity checksum does not match. Ask the sender to export it again.');
 return structuredClone(parsed);
}
