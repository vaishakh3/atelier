import type {AiProposal,LayoutProposal} from './types';

export type TurnStatus='proposed'|'applied'|'rejected'|'superseded'|'analysis';
export interface CopilotTurn {
 id:string;prompt:string;summary:string;issues:string[];kind:AiProposal['kind'];selectedIds:string[];
 status:TurnStatus;projectVersion:number;createdAt:string;layout?:LayoutProposal;localEdit?:AiProposal['localEdit'];upperFloor?:AiProposal['upperFloor'];roomResize?:AiProposal['roomResize'];
}
export interface CopilotConversation {projectId:string;turns:CopilotTurn[]}
