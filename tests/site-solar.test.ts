import {describe,expect,it} from 'vitest';
import {createBlankProject} from '../src/domain/seed';
import {emptySiteContext} from '../src/site/types';
import {analyseSunHours,directSunObstruction,projectedShadow,rayPrism,rayTriangle,solarPosition} from '../src/site/solar';
import {parseSiteObj} from '../src/site/exchange';
const site=()=>({...emptySiteContext(),latitude:0,longitude:0,utcOffsetHours:0});
describe('Transparent geometric solar screening',()=>{
 it('checks the approximate method against the published SPA example at a deliberately coarse tolerance',()=>{
  // Reda & Andreas, NREL/TP-560-34302, Appendix A.5:
  // https://docs.nlr.gov/docs/fy08osti/34302.pdf . This is NOT an SPA implementation or accuracy certification.
  const result=solarPosition({...site(),latitude:39.742476,longitude:-105.1786,utcOffsetHours:-7},'2003-10-17',12+30/60+30/3600);
  expect(Math.abs(result.azimuth-194.34024)).toBeLessThan(.6);expect(Math.abs(result.elevation-(90-50.11162))).toBeLessThan(.6);
 });
 it('matches solstice geometry and rotates the sun vector with the shared true-north convention',()=>{
  const result=solarPosition({...site(),latitude:45},'2026-06-21',12);expect(result.elevation).toBeCloseTo(68.45,1);expect(result.azimuth).toBeGreaterThan(178);expect(result.azimuth).toBeLessThan(181);
  const rotated=solarPosition({...site(),latitude:45,trueNorthAngle:90},'2026-06-21',12);expect(rotated.direction.x).toBeCloseTo(-result.direction.y,8);expect(rotated.direction.y).toBeCloseTo(result.direction.x,8);expect(rotated.elevation).toBe(result.elevation);
  expect(Math.hypot(rotated.direction.x,rotated.direction.y,rotated.direction.z)).toBeCloseTo(1,10);
 });
 it('uses geographic longitude and UTC offset, including fractional-hour offsets',()=>{
  const india={...site(),latitude:10,longitude:76,utcOffsetHours:5.5},a=solarPosition(india,'2026-03-20',12),b=solarPosition({...india,utcOffsetHours:0},'2026-03-20',6.5);
  expect(Math.abs(a.elevation-b.elevation)).toBeLessThan(.1);expect(solarPosition(india,'2026-03-20',0).aboveHorizon).toBe(false);
  expect(()=>solarPosition({...site(),latitude:null},'2026-03-20',12)).toThrow(/latitude/);expect(()=>solarPosition(site(),'2026-02-30',12)).toThrow(/valid/);
  expect(()=>solarPosition({...site(),trueNorthAngle:Infinity},'2026-03-20',12)).toThrow(/finite true-north/);
 });
 it('tests rays against exact prism sides/tops and mesh triangles, rather than drawn shadow decorations',()=>{
  const polygon=[{x:1,y:-1},{x:2,y:-1},{x:2,y:1},{x:1,y:1}];
  expect(rayPrism({x:0,y:0,z:1},{x:1,y:0,z:.1},polygon,0,3)).toBe(true);
  expect(rayPrism({x:0,y:0,z:4},{x:1,y:0,z:.1},polygon,0,3)).toBe(false);
  expect(rayTriangle({x:0,y:0,z:0},{x:0,y:0,z:1},{x:-1,y:-1,z:2},{x:1,y:-1,z:2},{x:0,y:1,z:2})).toBe(true);
  expect(rayTriangle({x:3,y:0,z:0},{x:0,y:0,z:1},{x:-1,y:-1,z:2},{x:1,y:-1,z:2},{x:0,y:1,z:2})).toBe(false);
 });
 it('counts open-site sun-hours and suppresses them inside an opaque model obstruction',()=>{
  const project=createBlankProject('Sun rays'),position={x:0,y:0,z:1},open=analyseSunHours(project,site(),'2026-03-20',[position],30);
  expect(open.samples).toBe(48);expect(open.potentialDaylightHours).toBe(12);expect(open.receivers[0].directSunHours).toBe(12);
  project.elements=[{id:'obstruction',kind:'reference',name:'Opaque context proxy',levelId:project.levels[0].id,typeId:'none',material:'Reference',x:-2,y:-2,z:0,width:4,depth:4,height:3,rotation:0,editable:false,properties:{}}];
  const blocked=analyseSunHours(project,site(),'2026-03-20',[position],30);expect(blocked.receivers[0].directSunHours).toBe(0);expect(blocked.receivers[0].shadedHours).toBe(12);
 });
 it('includes placed context triangles but not untriangulated survey points as blockers',()=>{
  const project=createBlankProject('Mesh shade'),context=parseSiteObj('v -10 -10 2\nv 10 -10 2\nv 0 10 2\nf 1 2 3');
  const sun={x:0,y:0,z:1},point={x:0,y:0,z:0};
  expect(directSunObstruction(project,{...site(),contexts:[context]},point,sun)?.kind).toBe('context');
  expect(directSunObstruction(project,{...site(),terrain:{source:'Survey XYZ only',vertices:[{x:0,y:0,z:2}],faces:[]}},point,sun)).toBeNull();
 });
 it('projects a known shadow length and identifies unsupported sampling inputs',()=>{
  const sun={azimuth:90,elevation:45,declination:0,equationOfTime:0,aboveHorizon:true,direction:{x:Math.SQRT1_2,y:0,z:Math.SQRT1_2}};
  expect(projectedShadow([{x:0,y:0}],3,0,sun)[0].x).toBeCloseTo(-3);expect(projectedShadow([{x:0,y:0}],3,0,{...sun,aboveHorizon:false})).toEqual([]);
  expect(()=>analyseSunHours(createBlankProject('Invalid'),site(),'2026-03-20',[],30)).toThrow(/receiver/);expect(()=>analyseSunHours(createBlankProject('Invalid'),site(),'2026-03-20',[{x:0,y:0,z:0}],1)).toThrow(/interval/);
 });
});
