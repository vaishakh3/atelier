// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import CommandPalette from '../src/components/CommandPalette';
import type {CommandPaletteCommand} from '../src/components/CommandPalette';

afterEach(cleanup);
function commands():CommandPaletteCommand[]{return[
 {id:'model',label:'Model',group:'Project views',run:vi.fn()},
 {id:'services',label:'Services',group:'Project views',run:vi.fn()},
 {id:'fit-selection',label:'Fit selection',group:'View controls',shortcut:'F',disabled:true,disabledReason:'Select a model element first',run:vi.fn()},
 {id:'fit-all',label:'Fit all',group:'View controls',run:vi.fn()},
 {id:'room-42',label:'Kitchen · Ground floor',group:'Model elements',searchText:'room ceramic tile',run:vi.fn()},
 ];}
describe('Searchable project command palette',()=>{
 it('searches views, actions and model IDs, including multiple query terms',()=>{
  render(<CommandPalette commands={commands()} onClose={vi.fn()}/>);
  const input=screen.getByRole('combobox',{name:'Search commands and model elements'});
  expect(document.activeElement).toBe(input);
  fireEvent.change(input,{target:{value:'view fit'}});
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(screen.getByText('Select a model element first')).toBeTruthy();
  fireEvent.change(input,{target:{value:'ceramic'}});
  expect(screen.getByText('Kitchen · Ground floor')).toBeTruthy();
  fireEvent.change(input,{target:{value:'room-42'}});
  expect(screen.getAllByRole('option')).toHaveLength(1);expect(screen.getByText('Kitchen · Ground floor')).toBeTruthy();
  fireEvent.change(input,{target:{value:'no-such-element'}});
  expect(screen.getByText('No matching commands or elements')).toBeTruthy();
 });

 it('navigates enabled results with arrows and runs the active command on Enter',()=>{
  const choices=commands(),close=vi.fn();render(<CommandPalette commands={choices} onClose={close}/>);
  const input=screen.getByRole('combobox');
  fireEvent.keyDown(input,{key:'ArrowDown'});
  expect(screen.getByRole('option',{name:'Services'}).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(input,{key:'ArrowDown'});
  expect(screen.getByRole('option',{name:'Fit all'}).getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input,{key:'Enter'});
  expect(choices[3].run).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
 });

 it('keeps disabled commands discoverable but cannot execute them',()=>{
  const choices=commands(),close=vi.fn();render(<CommandPalette commands={choices} onClose={close}/>);
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'fit selection'}});
  const option=screen.getByRole('option');expect(option.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(option);fireEvent.keyDown(screen.getByRole('combobox'),{key:'Enter'});
  expect(choices[2].run).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 });

 it('closes on Escape and restores the original trigger after unmounting',()=>{
  const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();
  const close=vi.fn(),view=render(<CommandPalette commands={commands()} onClose={close}/>);
  fireEvent.keyDown(screen.getByRole('combobox'),{key:'Escape'});
  expect(close).toHaveBeenCalledTimes(1);view.unmount();expect(document.activeElement).toBe(trigger);trigger.remove();
 });

 it('preserves the dialog when a command fails and exposes an actionable error',()=>{
  const close=vi.fn();render(<CommandPalette commands={[{id:'failure',label:'Try operation',group:'Actions',run:()=>{throw new Error('The project changed. Review a fresh proposal.');}}]} onClose={close}/>);
  fireEvent.keyDown(screen.getByRole('combobox'),{key:'Enter'});
  expect(screen.getByRole('alert').textContent).toContain('project changed');expect(close).not.toHaveBeenCalled();
 });

 it('traps Tab between the search and close controls without tabbing through every result',()=>{
  render(<CommandPalette commands={commands()} onClose={vi.fn()}/>);
  const input=screen.getByRole('combobox'),close=screen.getByRole('button',{name:'Close dialog'});
  for(const element of [input,close])Object.defineProperty(element,'offsetParent',{get:()=>document.body,configurable:true});
  input.focus();fireEvent.keyDown(input,{key:'Tab'});expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(input);
  expect(screen.getAllByRole('option').every(option=>option.tabIndex===-1)).toBe(true);
 });
});
