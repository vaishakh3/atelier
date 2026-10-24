// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import DesignWorkbench,{designComparisonMetrics,SynchronizedPlanComparison} from '../src/components/DesignWorkbench';
import {createDemoProject} from '../src/domain/seed';
import {createDesignProposal,initializeDesignWorkbench} from '../src/domain/designWorkbench';

beforeAll(()=>{
 vi.stubGlobal('PointerEvent',MouseEvent);
 Object.defineProperty(SVGSVGElement.prototype,'getBoundingClientRect',{configurable:true,value(){return{x:0,y:0,width:600,height:400,left:0,right:600,top:0,bottom:400,toJSON(){return{};}};}});
});
afterEach(cleanup);
const frame=(index:number)=>screen.getByTestId(`comparison-plan-${index}`).getAttribute('viewBox');

describe('actual synchronized design plan comparison',()=>{
 it('renders both real geometries at one scale and links zoom, pan, fit and floor changes',()=>{
  const left=createDemoProject(),right=structuredClone(left);right.elements.find(element=>element.kind==='room')!.width=3;
  const original=JSON.stringify([left,right]);
  render(<SynchronizedPlanComparison left={left} right={right} leftName="Original" rightName="Alternative"/>);
  const first=frame(0);expect(frame(1)).toBe(first);
  expect(screen.getByTestId('comparison-plan-0').querySelectorAll('polygon').length).toBeGreaterThan(5);
  fireEvent.click(screen.getByRole('button',{name:'Zoom both plans in'}));
  expect(frame(0)).not.toBe(first);expect(frame(1)).toBe(frame(0));
  const zoomed=frame(0),svg=screen.getByTestId('comparison-plan-1');
  fireEvent.pointerDown(svg,{button:0,clientX:100,clientY:100});fireEvent.pointerMove(svg,{clientX:150,clientY:130});fireEvent.pointerUp(svg);
  expect(frame(0)).not.toBe(zoomed);expect(frame(1)).toBe(frame(0));
  fireEvent.click(screen.getByRole('button',{name:'Fit both'}));expect(frame(0)).toBe(first);expect(frame(1)).toBe(first);
  fireEvent.change(screen.getByRole('combobox',{name:'Comparison floor'}),{target:{value:'level-1'}});expect(frame(1)).toBe(frame(0));
  expect(JSON.stringify([left,right])).toBe(original);
 });

 it('never treats hidden drawing geometry as removed cost scope or unresolved dates as zero days',()=>{
  const left=createDemoProject();left.schedule.modelReviewRequired=true;
  const right=structuredClone(left),metrics=designComparisonMetrics(left),hidden=left.elements.map(element=>element.id);
  render(<SynchronizedPlanComparison left={left} right={right} leftName="One" rightName="Two" hiddenIds={hidden}/>);
  expect(screen.getByTestId('comparison-plan-0').querySelectorAll('polygon')).toHaveLength(0);
  expect(designComparisonMetrics(left)).toEqual(metrics);
  expect(screen.getAllByText(/Known cost subtotal/)).toHaveLength(2);
  expect(screen.getAllByText('Unresolved').length).toBeGreaterThanOrEqual(2);
 });

 it('labels the legacy automatically generated programme as construction output, never professionally reviewed',()=>{
  const left=createDemoProject();render(<SynchronizedPlanComparison left={left} right={structuredClone(left)} leftName="Legacy" rightName="Copy"/>);
  expect(screen.queryByText('Reviewed programme')).toBeNull();expect(screen.getAllByText('Construction programme')).toHaveLength(2);
 });
});

describe('design proposal workspace permissions and transactions',()=>{
 it('creates a named branch with one complete callback and blocks reviewer edits',()=>{
  const initial=initializeDesignWorkbench(createDemoProject(),'editor'),onCommit=vi.fn(),{rerender}=render(<DesignWorkbench project={initial} onCommit={onCommit} canEdit/>);
  fireEvent.change(screen.getByRole('textbox',{name:'New proposal name'}),{target:{value:'Courtyard branch'}});
  fireEvent.click(screen.getByRole('button',{name:'Create independent proposal'}));
  expect(onCommit).toHaveBeenCalledTimes(1);expect(onCommit.mock.calls[0][0].workbench.proposals).toHaveLength(2);
  expect(initial.workbench!.proposals).toHaveLength(1);
  const next=createDesignProposal(initial,'Two','editor');rerender(<DesignWorkbench project={next} onCommit={onCommit} canEdit={false}/>);
  expect(screen.getByRole('button',{name:'Create independent proposal'}).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button',{name:'Open proposal'}).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Persistent layers'}));expect(screen.getByRole('button',{name:'Create layer'}).hasAttribute('disabled')).toBe(true);
  expect(onCommit).toHaveBeenCalledTimes(1);
 });
});
