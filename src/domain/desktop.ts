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
