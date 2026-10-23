export const menuActions=['new-project','import','save-local','save-project','export-ifc','export-pdf','export-xlsx','undo','redo','settings','help'] as const;
export type DesktopMenuAction=typeof menuActions[number];
export interface DesktopInfo {version:string;platform:string;dataPath:string;aiConfigured:boolean}
export interface CloseResult {ok:boolean;error?:string}
