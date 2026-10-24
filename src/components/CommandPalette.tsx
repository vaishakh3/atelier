import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,Command,Search} from 'lucide-react';
import {Modal} from './ui';
import './CommandPalette.css';

export interface CommandPaletteCommand {
 id:string;
 label:string;
 group:string;
 shortcut?:string;
 /** Extra searchable metadata, such as a model element material or class. */
 searchText?:string;
 disabled?:boolean;
 disabledReason?:string;
 run:()=>void;
}
type Props={commands:CommandPaletteCommand[];onClose:()=>void};
const normalise=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const maximumVisible=80;

/** The input owns keyboard focus; aria-activedescendant exposes the current result. */
export default function CommandPalette({commands,onClose}:Props){
 const [query,setQuery]=useState(''),[activeId,setActiveId]=useState(''),[error,setError]=useState('');
 const listId=useId(),hintId=useId(),input=useRef<HTMLInputElement>(null),rows=useRef(new Map<number,HTMLDivElement>());
 // Capture before autoFocus runs: Modal's effect alone would capture this dialog's input.
 const trigger=useRef(typeof document==='undefined'?null:document.activeElement as HTMLElement|null);
 const filtered=useMemo(()=>{const terms=normalise(query).trim().split(/\s+/).filter(Boolean);const matches=commands.filter(command=>terms.every(term=>normalise(`${command.label} ${command.group} ${command.id} ${command.searchText??''}`).includes(term))),groups=new Map<string,CommandPaletteCommand[]>();for(const command of matches){const group=groups.get(command.group)??[];group.push(command);groups.set(command.group,group);}return [...groups.values()].flat();},[commands,query]);
 const visible=filtered.slice(0,maximumVisible),enabled=visible.flatMap((command,index)=>command.disabled?[]:[index]);
 const requestedIndex=visible.findIndex(command=>command.id===activeId&&!command.disabled),activeIndex=requestedIndex<0?(enabled[0]??-1):requestedIndex;
 const grouped=new Map<string,{command:CommandPaletteCommand;index:number}[]>();
 visible.forEach((command,index)=>{const items=grouped.get(command.group)??[];items.push({command,index});grouped.set(command.group,items);});
 useEffect(()=>{input.current?.focus();return()=>{if(trigger.current?.isConnected)trigger.current.focus();};},[]);
 useEffect(()=>{if(activeIndex>=0)rows.current.get(activeIndex)?.scrollIntoView?.({block:'nearest'});},[activeIndex,query]);
 function run(command:CommandPaletteCommand){if(command.disabled)return;try{command.run();onClose();}catch(reason){setError(reason instanceof Error?reason.message:'This command could not be completed.');}}
 function navigate(key:string){if(!enabled.length)return;const position=enabled.indexOf(activeIndex);const next=key==='Home'?enabled[0]:key==='End'?enabled[enabled.length-1]:enabled[(position+(key==='ArrowDown'?1:enabled.length-1))%enabled.length];setActiveId(visible[next].id);}
 return <div className="command-palette-host"><Modal title="Commands & model search" onClose={onClose}><div className="command-palette-body">
  <div className="command-palette-search"><Search size={18} aria-hidden="true"/><input ref={input} autoFocus role="combobox" aria-label="Search commands and model elements" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={activeIndex<0?undefined:`${listId}-option-${activeIndex}`} aria-describedby={hintId} placeholder="Search a view, action or model element…" value={query} onChange={event=>{setQuery(event.target.value);setActiveId('');setError('');}} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)||!query&&['Home','End'].includes(event.key)){event.preventDefault();navigate(event.key);}if(event.key==='Enter'&&activeIndex>=0){event.preventDefault();run(visible[activeIndex]);}}}/><kbd>Esc</kbd></div>
  {error&&<p className="command-palette-error" role="alert">{error}</p>}
  <div className="command-palette-results" role="listbox" aria-label="Commands and model elements" id={listId}>
   {[...grouped].map(([group,items])=><div role="group" aria-label={group} className="command-palette-group" key={group}><div className="command-palette-group-label" aria-hidden="true">{group}</div>{items.map(({command,index})=><div key={command.id} ref={element=>{if(element)rows.current.set(index,element);else rows.current.delete(index);}} id={`${listId}-option-${index}`} role="option" aria-selected={index===activeIndex} aria-disabled={!!command.disabled} className={`command-palette-result${index===activeIndex?' active':''}${command.disabled?' disabled':''}`} onMouseDown={event=>event.preventDefault()} onMouseMove={()=>{if(!command.disabled)setActiveId(command.id);}} onClick={()=>run(command)}><span className="command-palette-command-icon"><Command size={13} aria-hidden="true"/></span><span className="command-palette-command-label"><strong>{command.label}</strong>{command.disabled&&<small>{command.disabledReason||'Unavailable in the current context'}</small>}</span>{command.shortcut&&<kbd>{command.shortcut}</kbd>}{!command.disabled&&<ArrowUpRight className="command-palette-run-icon" size={13} aria-hidden="true"/>}</div>)}</div>)}
   {!visible.length&&<div className="command-palette-empty"><Search size={23} aria-hidden="true"/><strong>No matching commands or elements</strong><p>Try a view name, an action or an element's name.</p></div>}
  </div>
  <footer className="command-palette-footer"><span id={hintId}><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>Enter</kbd> run</span><span role="status" aria-live="polite">{filtered.length>maximumVisible?`Showing ${maximumVisible} of ${filtered.length} · type to narrow`:`${filtered.length} result${filtered.length===1?'':'s'}`}</span></footer>
 </div></Modal></div>;
}
