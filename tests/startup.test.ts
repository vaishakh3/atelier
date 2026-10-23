import {describe,it,expect} from 'vitest';
import {resolveStartupProject} from '../src/domain/startup';
import {createDemoProject} from '../src/domain/seed';

describe('desktop project recovery',()=>{
  const sample=createDemoProject();
  const older={...sample,id:'older',updatedAt:'2026-10-20T10:00:00Z'};
  const newest={...sample,id:'newest',updatedAt:'2026-10-24T10:00:00Z'};
  it('reopens the newest disk project without a browser recovery copy',()=>{
    expect(resolveStartupProject(sample,[older,newest],false)).toBe(newest);
  });
  it('retains a newer unsaved recovery copy',()=>{
    const recovery={...older,updatedAt:'2026-10-25T10:00:00Z'};
    expect(resolveStartupProject(recovery,[older,newest],true)).toBe(recovery);
  });
  it('prefers a newer disk revision of the recovered project',()=>{
    const disk={...older,version:20,updatedAt:'2026-10-26T10:00:00Z'};
    expect(resolveStartupProject(older,[disk],true)).toBe(disk);
  });
  it('opens the sample only when disk and recovery are empty',()=>{
    expect(resolveStartupProject(sample,[],false)).toBe(sample);
  });
});
