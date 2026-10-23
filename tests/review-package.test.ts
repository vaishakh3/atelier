import {describe,it,expect} from 'vitest';
import {createReviewPackage,readReviewPackage} from '../src/domain/reviewPackage';
import {createDemoProject} from '../src/domain/seed';
import type {SavedVersion} from '../src/domain/types';
const snapshot:SavedVersion={id:'snapshot-test',label:'Approved baseline',actor:'Test architect',timestamp:'2026-10-24T00:00:00Z',project:createDemoProject()};
describe('portable immutable review copy',()=>{
 it('round trips a detached snapshot and includes only matching comments',async()=>{const before=JSON.stringify(snapshot);const packet=await createReviewPackage(snapshot,[{id:'comment-a',versionId:snapshot.id,author:'Reviewer',text:'Confirm window specification',createdAt:snapshot.timestamp},{id:'comment-b',versionId:'another-version',author:'Reviewer',text:'Other private review',createdAt:snapshot.timestamp}]);const parsed=await readReviewPackage(packet);expect(parsed.comments).toHaveLength(1);parsed.snapshot.project.elements[0].width=999;expect(JSON.stringify(snapshot)).toBe(before);});
 it('rejects changed geometry with an unchanged checksum',async()=>{const packet=await createReviewPackage(snapshot,[]);packet.snapshot.project.elements[0].height=8;await expect(readReviewPackage(packet)).rejects.toThrow('checksum');});
 it('rejects non-project payloads and impossible unknown fields',async()=>{const packet=await createReviewPackage(snapshot,[]);await expect(readReviewPackage({...packet,format:'executable-review',script:'unsafe'})).rejects.toThrow();});
});
