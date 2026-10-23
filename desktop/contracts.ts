export const menuActions=['new-project','import','save-local','save-project','export-ifc','export-pdf','export-xlsx','export-backup','import-backup','undo','redo','settings','help'] as const;
export type DesktopMenuAction=typeof menuActions[number];
export interface DesktopInfo {version:string;platform:string;dataPath:string;aiConfigured:boolean;model:string;storageEncrypted:boolean;keySource:'secure-storage'|'external-env'|'development-env'|'none';updateStatus:'disabled'|'available'|'up-to-date'|'unavailable'}
export interface ApiKeyInput {apiKey:string;model?:string}
export interface ApiKeyStatus {configured:boolean;model:string}
export interface CloseResult {ok:boolean;error?:string}
