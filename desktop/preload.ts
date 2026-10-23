import { contextBridge, ipcRenderer } from 'electron';
import { menuActions } from './contracts';
import type { CloseResult, DesktopInfo, DesktopMenuAction } from './contracts';

contextBridge.exposeInMainWorld('atelierDesktop',Object.freeze({
  getInfo:():Promise<DesktopInfo>=>ipcRenderer.invoke('atelier:get-info'),
  onMenuAction:(callback:(action:DesktopMenuAction)=>void)=>{
    if(typeof callback!=='function')throw new TypeError('A menu listener is required.');
    const listener=(_event:unknown,action:unknown)=>{if(typeof action==='string'&&(menuActions as readonly string[]).includes(action))callback(action as DesktopMenuAction);};
    ipcRenderer.on('atelier:menu-action',listener);
    return()=>{ipcRenderer.removeListener('atelier:menu-action',listener);};
  },
  onBeforeClose:(callback:()=>void)=>{
    if(typeof callback!=='function')throw new TypeError('A close listener is required.');
    const listener=()=>callback();ipcRenderer.on('atelier:before-close',listener);
    return()=>{ipcRenderer.removeListener('atelier:before-close',listener);};
  },
  completeClose:(result:CloseResult)=>{
    if(!result||typeof result.ok!=='boolean')throw new TypeError('A save result is required.');
    ipcRenderer.send('atelier:complete-close',{ok:result.ok,...(typeof result.error==='string'?{error:result.error.slice(0,400)}:{})});
  }
}));
