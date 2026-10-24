import {ChevronRight} from 'lucide-react';
import './ProposalNotes.css';

/** Proposal issues are review notes, not a structured severity/error channel. */
export default function ProposalNotes({notes}:{notes:readonly string[]}){
 if(!notes.length)return null;
 return <details className="proposal-notes"><summary tabIndex={0}><ChevronRight size={13} aria-hidden="true"/><span>Design notes & assumptions</span><span className="proposal-notes-count"> · {notes.length}</span></summary><ul aria-label="Design notes and assumptions">{notes.map((note,index)=><li key={index}>{note}</li>)}</ul></details>;
}
