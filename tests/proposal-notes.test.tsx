// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import ProposalNotes from '../src/components/ProposalNotes';
afterEach(cleanup);

describe('compact proposal review notes',()=>{
 it('starts collapsed and exposes every unchanged note through a keyboard-focusable native disclosure',()=>{
  const notes=['Review room dimensions.','Specialist scope remains unpriced.','Review room dimensions.','A note with a line break\nand <literal markup>.'];
  render(<ProposalNotes notes={notes}/>);const summary=screen.getByText('Design notes & assumptions').closest('summary')!,details=summary.closest('details')!;
  expect(details.open).toBe(false);expect(summary.textContent).toBe('Design notes & assumptions · 4');expect(summary.tabIndex).toBe(0);summary.focus();expect(document.activeElement).toBe(summary);
  fireEvent.click(summary);expect(details.open).toBe(true);
  const list=within(details).getByRole('list',{name:'Design notes and assumptions'});expect(within(list).getAllByRole('listitem').map(item=>item.textContent)).toEqual(notes);
  expect(details.querySelector('literal')).toBeNull();expect(details.querySelector('.warning')).toBeNull();expect(within(details).queryByRole('alert')).toBeNull();
  fireEvent.click(summary);expect(details.open).toBe(false);
 });
 it('updates its count without discarding duplicate notes and omits an empty disclosure',()=>{
  const view=render(<ProposalNotes notes={['First note']}/>);expect(screen.getByText('· 1')).toBeTruthy();view.rerender(<ProposalNotes notes={['Repeated','Repeated']}/>);expect(screen.getByText('· 2')).toBeTruthy();expect(document.querySelectorAll('.proposal-notes li')).toHaveLength(2);
  view.rerender(<ProposalNotes notes={[]}/>);expect(document.querySelector('details')).toBeNull();
 });
});
