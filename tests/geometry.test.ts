import { describe, expect, it } from 'vitest';
import { createBlankProject } from '../src/domain/seed';
import type { BimElement } from '../src/domain/types';
import { cameraFitDistance, createDrawnElement, footprint, localToWorld, modelBounds, nearestHostWall, wallSegments, worldToLocal } from '../src/model/geometry';

function wall(extra:Partial<BimElement>={}):BimElement {
  return {id:'w',kind:'wall',name:'Wall',levelId:'level-0',typeId:'wall-aac',material:'AAC block',x:0,y:0,z:0,width:6,depth:.2,height:3,rotation:0,editable:true,properties:{},...extra};
}
describe('BIM editing geometry',()=>{
  it('fits the full building sphere with margin on narrow and wide canvases',()=>{
    const radius=8.4,verticalHalf=36*Math.PI/360;
    for(const aspect of [520/600,.5,1,2]) {
      const distance=cameraFitDistance(radius,36,aspect);
      const limitingHalf=Math.min(verticalHalf,Math.atan(Math.tan(verticalHalf)*aspect));
      expect(Math.asin(radius/distance)).toBeLessThan(limitingHalf);
      expect(distance).toBeCloseTo(radius/Math.sin(limitingHalf)*1.2);
    }
    expect(cameraFitDistance(radius,36,.5)).toBeGreaterThan(cameraFitDistance(radius,36,2));
  });
  it('keeps rotated native coordinates invertible',()=>{
    const e=wall({x:10,y:-5,rotation:37});
    const point=worldToLocal(e,localToWorld(e,4,.2));
    expect(point.x).toBeCloseTo(4,8);expect(point.y).toBeCloseTo(.2,8);
  });
  it('includes rotated thickness in model bounds',()=>{
    const bounds=modelBounds([wall({x:5,y:2,rotation:90})]);
    expect(bounds.minX).toBeCloseTo(4.8);expect(bounds.maxX).toBeCloseTo(5);expect(bounds.maxY).toBeCloseTo(8);
    expect(footprint(wall())).toHaveLength(4);
  });
  it('preserves lintel and sill around hosted windows',()=>{
    const w=wall();
    const window:BimElement={...wall(),id:'win',kind:'window',hostId:'w',x:2,width:2,z:1,height:1.5};
    const segments=wallSegments(w,[window]);
    expect(segments.reduce((sum,s)=>sum+s.width*s.height,0)).toBeCloseTo(18-3);
    expect(segments.some(s=>s.x===2&&s.bottom===2.5&&s.height===.5)).toBe(true);
    expect(segments.some(s=>s.x===2&&s.bottom===0&&s.height===1)).toBe(true);
  });
  it('handles overlapping openings without negative geometry or double subtraction',()=>{
    const w=wall();
    const a={...wall(),id:'d1',kind:'door' as const,hostId:'w',x:1,width:2,z:0,height:2};
    const b={...a,id:'d2',x:2};
    const segments=wallSegments(w,[a,b]);
    expect(segments.every(s=>s.width>0&&s.height>0)).toBe(true);
    expect(segments.reduce((sum,s)=>sum+s.width*s.height,0)).toBeCloseTo(12);
  });
  it('cuts openings on a rotated wall in local coordinates',()=>{
    const w=wall({x:5,y:3,rotation:90});
    const door={...w,...localToWorld(w,2,0),id:'door',kind:'door' as const,hostId:'w',width:1,height:2.1};
    expect(wallSegments(w,[door]).reduce((sum,s)=>sum+s.width*s.height,0)).toBeCloseTo(15.9);
  });
  it('draws a wall from start point in either direction with physical length',()=>{
    const p=createBlankProject('Test');
    const result=createDrawnElement(p,'wall',{x:4,y:3},{x:0,y:0},'level-0').element!;
    expect(result.width).toBe(5);expect(result.rotation).toBeCloseTo(-143.130102);
    expect(localToWorld(result,result.width,0).x).toBeCloseTo(0);
    expect(localToWorld(result,result.width,0).y).toBeCloseTo(0);
    expect(result.typeId).toBe('wall-aac');
  });
  it('places openings inside their nearest editable host and rejects unsupported placement',()=>{
    const p=createBlankProject('Test');p.elements=[wall({width:3,rotation:90})];
    const host=nearestHostWall(p,{x:0,y:2.9},'level-0');expect(host?.wall.id).toBe('w');
    const opening=createDrawnElement(p,'window',{x:0,y:2.9},{x:0,y:2.9},'level-0').element!;
    const local=worldToLocal(p.elements[0],opening);
    expect(opening.hostId).toBe('w');expect(local.x+opening.width).toBeLessThanOrEqual(3);expect(opening.z).toBe(.9);
    expect(createDrawnElement(p,'door',{x:8,y:8},{x:8,y:8},'level-0').error).toBeTruthy();
  });
  it('normalises rectangular drag direction and keeps slabs below the finished floor',()=>{
    const p=createBlankProject('Test');
    const e=createDrawnElement(p,'slab',{x:5,y:7},{x:1,y:2},'level-0').element!;
    expect([e.x,e.y,e.width,e.depth]).toEqual([1,2,4,5]);expect(e.z+e.height).toBe(0);
    expect(createDrawnElement(p,'wall',{x:0,y:0},{x:.01,y:0},'level-0').element).toBeUndefined();
  });
});
