export interface DesktopInfo {
  version: string;
  platform: string;
  dataPath: string;
  aiConfigured: boolean;
  model?: string;
  storageEncrypted?: boolean;
  keySource?: 'secure-storage'|'development-env'|'external-env'|'none';
  updateStatus?: string;
}

declare global {
  interface Window {
    atelierDesktop?: {
      openProductLink?(url:string):Promise<void>;
      getInfo(): Promise<DesktopInfo>;
      onMenuAction(callback: (action: string) => void): () => void;
      onBeforeClose(callback: () => void): () => void;
      completeClose(result: {ok: boolean; error?: string}): void;
      configureApiKey(input:{apiKey:string;model?:string}):Promise<{configured:boolean;model:string}>;
      chooseEnvFile():Promise<{configured:boolean;model:string}>;
      clearApiKey():Promise<void>;
    };
  }
}

export const isDesktop = () => Boolean(window.atelierDesktop);

/** Only called from an explicit product/source/search button. Desktop validates again in its main process. */
export async function openProductLink(url:string):Promise<void>{
  const {checkedProductLink}=await import('../../desktop/external-links');
  const checked=checkedProductLink(url);
  if(window.atelierDesktop){if(!window.atelierDesktop.openProductLink)throw new Error('Update Atelier to open product links.');await window.atelierDesktop.openProductLink(checked);return;}
  window.open(checked,'_blank','noopener,noreferrer');
}
