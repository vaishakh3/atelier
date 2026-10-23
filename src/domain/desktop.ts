export interface DesktopInfo {
  version: string;
  platform: string;
  dataPath: string;
  aiConfigured: boolean;
}

declare global {
  interface Window {
    atelierDesktop?: {
      getInfo(): Promise<DesktopInfo>;
      onMenuAction(callback: (action: string) => void): () => void;
      onBeforeClose(callback: () => void): () => void;
      completeClose(result: {ok: boolean; error?: string}): void;
    };
  }
}

export const isDesktop = () => Boolean(window.atelierDesktop);
