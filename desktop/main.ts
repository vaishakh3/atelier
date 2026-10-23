import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createApp } from '../server/app';
import { projectSchema } from '../src/domain/schema';
import type { CloseResult, DesktopInfo, DesktopMenuAction } from './contracts';

app.setName('Atelier');
app.setAboutPanelOptions({applicationName:'Atelier',applicationVersion:app.getVersion(),copyright:'Atelier BIM - local desktop pilot',credits:'A standalone BIM workspace for architects and planners.'});
const smokeTest=process.argv.includes('--smoke-test');
const rendererSecurity={contextIsolation:true,sandbox:true,nodeIntegration:false} as const;
let window:BrowserWindow|null=null,server:Server|null=null,origin='',dataPath='',allowClose=false,allowQuit=false,quitRequested=false,closing=false,closeDialogOpen=false;
let closeTimer:ReturnType<typeof setTimeout>|undefined;
interface DesktopConfig {envPath?:string;legacyDataDir?:string}

async function readConfiguration():Promise<DesktopConfig>{
  try{const value=JSON.parse(await readFile(path.join(app.getAppPath(),'desktop-config.json'),'utf8'));return{...(typeof value.envPath==='string'&&path.isAbsolute(value.envPath)?{envPath:value.envPath}:{}),...(typeof value.legacyDataDir==='string'&&path.isAbsolute(value.legacyDataDir)?{legacyDataDir:value.legacyDataDir}:{})};}
  catch{return{};}
}
async function migrateProjects(source?:string){
  await mkdir(dataPath,{recursive:true,mode:0o700});
  if(!source||path.resolve(source)===path.resolve(dataPath)||(await readdir(dataPath)).some(name=>/^[\w-]+\.json$/.test(name)))return;
  let names:string[];try{names=await readdir(source);}catch{return;}
  for(const name of names.filter(name=>/^[\w-]+\.json$/.test(name))){
    try{
      const filename=path.join(source,name);if((await stat(filename)).size>10*1024*1024)continue;
      const record=JSON.parse(await readFile(filename,'utf8')),parsed=projectSchema.safeParse(record.project);
      if(!parsed.success||`${parsed.data.id}.json`!==name)continue;
      const versions=(Array.isArray(record.versions)?record.versions:[]).flatMap((v:Record<string,unknown>)=>{const p=projectSchema.safeParse(v?.project);return p.success&&typeof v.id==='string'&&typeof v.label==='string'&&typeof v.actor==='string'&&typeof v.timestamp==='string'?[{id:v.id,label:v.label,actor:v.actor,timestamp:v.timestamp,project:p.data}]:[];});
      const comments=(Array.isArray(record.comments)?record.comments:[]).filter((c:Record<string,unknown>)=>c&&typeof c.id==='string'&&typeof c.versionId==='string'&&typeof c.author==='string'&&typeof c.createdAt==='string'&&typeof c.text==='string'&&c.text.length<=4000).map((c:Record<string,unknown>)=>({id:c.id,versionId:c.versionId,author:c.author,createdAt:c.createdAt,text:c.text}));
      await writeFile(path.join(dataPath,name),JSON.stringify({project:parsed.data,versions,comments}),{mode:0o600,flag:'wx'});
    }catch{/* Migration never overwrites an existing project or blocks recovery of others. */}
  }
}
const ownUrl=(value:string)=>{try{return new URL(value).origin===origin;}catch{return false;}};
function authorizedIpc(event:IpcMainEvent|IpcMainInvokeEvent){return !!window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&ownUrl(event.senderFrame?.url??'');}
function emit(action:DesktopMenuAction){if(window&&!window.isDestroyed()&&ownUrl(window.webContents.getURL()))window.webContents.send('atelier:menu-action',action);}
async function undoOrRedo(action:'undo'|'redo'){
  if(!window||window.isDestroyed())return;
  const editable=await window.webContents.executeJavaScript("(()=>{const e=document.activeElement;return !!e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.isContentEditable)})()").catch(()=>false);
  if(editable){if(action==='undo')window.webContents.undo();else window.webContents.redo();}else emit(action);
}
function installMenu(){
  const template:MenuItemConstructorOptions[]=[
    {label:'Atelier',submenu:[{role:'about'},{type:'separator'},{label:'Workspace Settings…',accelerator:'CmdOrCtrl+,',click:()=>emit('settings')},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {label:'File',submenu:[{label:'New Project…',accelerator:'CmdOrCtrl+N',click:()=>emit('new-project')},{label:'Import IFC or Project…',accelerator:'CmdOrCtrl+O',click:()=>emit('import')},{type:'separator'},{label:'Save',accelerator:'CmdOrCtrl+S',click:()=>emit('save-local')},{label:'Save Project Copy…',accelerator:'CmdOrCtrl+Shift+S',click:()=>emit('save-project')},{label:'Export',submenu:[{label:'IFC Model…',click:()=>emit('export-ifc')},{label:'Review PDF…',click:()=>emit('export-pdf')},{label:'Quantity and Cost Workbook…',click:()=>emit('export-xlsx')}]},{type:'separator'},{role:'close'}]},
    {label:'Edit',submenu:[{label:'Undo',accelerator:'CmdOrCtrl+Z',click:()=>{void undoOrRedo('undo');}},{label:'Redo',accelerator:'CmdOrCtrl+Shift+Z',click:()=>{void undoOrRedo('redo');}},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'},...(!app.isPackaged?[{role:'toggleDevTools' as const}]:[])]},
    {label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{type:'separator'},{role:'front'}]},
    {role:'help',submenu:[{label:'Atelier Help',click:()=>emit('help')}]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function clearCloseTimer(){if(closeTimer){clearTimeout(closeTimer);closeTimer=undefined;}}
async function closeProblem(message?:string){
  if(!window||window.isDestroyed()||!closing||closeDialogOpen)return;
  clearCloseTimer();closeDialogOpen=true;
  const result=await dialog.showMessageBox(window,{type:'warning',title:'Save before closing',message:'Atelier has not confirmed that your latest changes are saved.',detail:message?'Saving did not complete. Retry the save, keep working, or explicitly close without saving.':'The save is taking longer than expected. Wait and retry, or keep the project open.',buttons:['Retry Save','Keep Working','Close Without Saving'],defaultId:0,cancelId:1,noLink:true});
  closeDialogOpen=false;if(!window||window.isDestroyed())return;
  if(result.response===0){closing=false;requestClose();}else if(result.response===2){allowClose=true;window.close();}else{closing=false;quitRequested=false;}
}
function requestClose(){
  if(!window||window.isDestroyed()||closing)return;closing=true;window.webContents.send('atelier:before-close');clearCloseTimer();closeTimer=setTimeout(()=>{void closeProblem();},8000);
}
function installIpc(){
  ipcMain.handle('atelier:get-info',(event):DesktopInfo=>{if(!authorizedIpc(event))throw new Error('Untrusted desktop message');return{version:app.getVersion(),platform:process.platform,dataPath,aiConfigured:!!process.env.OPENAI_API_KEY};});
  ipcMain.on('atelier:complete-close',(event,result:CloseResult)=>{if(!authorizedIpc(event)||!closing||!result||typeof result.ok!=='boolean')return;if(result.ok){clearCloseTimer();allowClose=true;window?.close();}else void closeProblem('Save failed');});
}
function createWindow(){
  allowClose=false;closing=false;
  window=new BrowserWindow({title:'Atelier',width:1512,height:982,minWidth:1040,minHeight:700,show:false,backgroundColor:'#f5f5f7',titleBarStyle:'hiddenInset',trafficLightPosition:{x:18,y:20},autoHideMenuBar:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),partition:'persist:atelier-workspace',...rendererSecurity,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,safeDialogs:true}});
  const current=window;
  current.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  current.webContents.on('will-navigate',(event,url)=>{if(!ownUrl(url))event.preventDefault();});
  current.webContents.on('will-redirect',(event,url)=>{if(!ownUrl(url))event.preventDefault();});
  current.webContents.on('will-attach-webview',event=>event.preventDefault());
  current.once('ready-to-show',()=>{if(!smokeTest)current.show();});
  current.on('close',event=>{if(allowClose)return;event.preventDefault();requestClose();});
  current.on('closed',()=>{clearCloseTimer();window=null;if(quitRequested||process.platform!=='darwin'){allowQuit=true;server?.close();app.quit();}});
  current.webContents.on('render-process-gone',()=>{closing=false;clearCloseTimer();void dialog.showMessageBox(current,{type:'error',title:'Workspace stopped responding',message:'The workspace renderer stopped.',detail:'Saved projects remain in your desktop data folder. Reload the workspace to recover the most recently saved model.',buttons:['Reload Workspace','Keep Open'],defaultId:0,cancelId:1}).then(result=>{if(result.response===0&&!current.isDestroyed())void current.loadURL(origin);});});
  void current.loadURL(origin);
}
async function runSmoke(token:string){
  if(!window)return;const current=window;
  await new Promise<void>(resolve=>{if(!current.webContents.isLoading())resolve();else current.webContents.once('did-finish-load',()=>resolve());});
  await new Promise(resolve=>setTimeout(resolve,1600));
  const renderer=await current.webContents.executeJavaScript("({nodeUnavailable:typeof require==='undefined'&&typeof process==='undefined',hasBridge:typeof window.atelierDesktop?.getInfo==='function',renderedApp:!!document.querySelector('#root')?.children.length})");
  const untrusted=await fetch(`${origin}/api/health`);const trusted=await fetch(`${origin}/api/health`,{headers:{'X-Atelier-Desktop':token}});
  const result={...renderer,contextIsolationConfigured:rendererSecurity.contextIsolation,sandboxConfigured:rendererSecurity.sandbox,loopbackProtected:untrusted.status===403,backendReady:trusted.status===200,packaged:app.isPackaged};
  console.log(`ATELIER_DESKTOP_SMOKE ${JSON.stringify(result)}`);
  const ok=Object.entries(result).filter(([key])=>key!=='packaged').every(([,value])=>value===true);
  allowQuit=true;allowClose=true;current.destroy();server?.close();app.exit(ok?0:1);
}

if(!app.requestSingleInstanceLock()){app.quit();}
else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}else if(origin)createWindow();});
  app.on('before-quit',event=>{quitRequested=true;if(!allowQuit&&window&&!window.isDestroyed()&&!allowClose){event.preventDefault();requestClose();}else server?.close();});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin'){allowQuit=true;server?.close();app.quit();}});
  app.on('activate',()=>{if(!window&&origin)createWindow();});
  void app.whenReady().then(async()=>{
    const configuration=await readConfiguration();if(configuration.envPath)loadEnv({path:configuration.envPath,quiet:true});
    dataPath=path.join(app.getPath('userData'),'projects');await migrateProjects(configuration.legacyDataDir);
    const token=randomBytes(32).toString('hex');
    const backend=createApp({dataDir:dataPath,staticDir:path.join(app.getAppPath(),'dist'),mode:'desktop-pilot',desktopHeaderToken:token});
    server=await new Promise<Server>((resolve,reject)=>{const instance=backend.listen(0,'127.0.0.1',()=>resolve(instance));instance.once('error',reject);});
    const address=server.address();if(!address||typeof address==='string')throw new Error('Could not allocate desktop backend');origin=`http://127.0.0.1:${address.port}`;
    const desktopSession=session.fromPartition('persist:atelier-workspace');
    desktopSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));desktopSession.setPermissionCheckHandler(()=>false);
    desktopSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>callback({cancel:!ownUrl(details.url)&&!details.url.startsWith('data:')&&!details.url.startsWith(`blob:${origin}/`)}));
    desktopSession.webRequest.onBeforeSendHeaders({urls:[`${origin}/*`]},(details,callback)=>callback({requestHeaders:{...details.requestHeaders,'X-Atelier-Desktop':token}}));
    desktopSession.on('will-download',(_event,item,contents)=>{if(!window||contents!==window.webContents){item.cancel();return;}const filename=path.basename(item.getFilename())||'Atelier export';item.setSaveDialogOptions({title:'Save Atelier Export',defaultPath:path.join(app.getPath('downloads'),filename),buttonLabel:'Save',properties:['showOverwriteConfirmation']});});
    installIpc();installMenu();createWindow();console.log('Atelier desktop backend is ready.');
    if(smokeTest)await runSmoke(token);
  }).catch(()=>{dialog.showErrorBox('Atelier could not start','The desktop workspace could not start. Confirm that the application bundle is intact and its data folder is writable.');allowQuit=true;app.exit(1);});
}
