import { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Server } from 'node:http';
import path from 'node:path';
import { config as loadEnv, parse as parseEnv } from 'dotenv';
import { createApp } from '../server/app';
import type { ApiKeyInput, ApiKeyStatus, CloseResult, DesktopInfo, DesktopMenuAction } from './contracts';
import { defaultModel, getProfileDataKey, loadApiCredential, removeApiCredential, saveApiCredential, validateApiKey, validateModel, writePrivatePreferences } from './secure-store';
import type { SecureStorageAdapter } from './secure-store';
import { createDiagnosticLogger } from './diagnostics';
import { validateUpdateConfig, verifySignedUpdateFeed } from './updates';
import type { TrustedUpdateConfig } from './updates';
import { assertWorkspaceAdministrator } from './authorization';
import { preserveLegacyLocalStorage } from './legacy-storage';
import { assertDesktopBackendReady, DesktopStartupError } from './backend-readiness';

app.setName('Atelier');
app.setAboutPanelOptions({applicationName:'Atelier',applicationVersion:app.getVersion(),copyright:'Atelier BIM',credits:'A standalone BIM workspace for architects and planners.'});
const defaultProfile=app.getPath('userData');
const isolatedTestProfile=process.env.ATELIER_TEST_MODE==='1'&&!!process.env.ATELIER_PROFILE_DIR&&path.isAbsolute(process.env.ATELIER_PROFILE_DIR)&&path.resolve(process.env.ATELIER_PROFILE_DIR)!==path.resolve(defaultProfile)&&/(test|qa|smoke|e2e)/i.test(path.basename(process.env.ATELIER_PROFILE_DIR));
if(isolatedTestProfile)app.setPath('userData',process.env.ATELIER_PROFILE_DIR!);
const smokeTest=process.argv.includes('--smoke-test');
const rendererSecurity={contextIsolation:true,sandbox:true,nodeIntegration:false} as const;
const productionPartition='persist:atelier-production';
let window:BrowserWindow|null=null,server:Server|null=null,origin='',dataPath='',allowClose=false,allowQuit=false,quitRequested=false,closing=false,closeDialogOpen=false;
let closeTimer:ReturnType<typeof setTimeout>|undefined;
let keySource:DesktopInfo['keySource']='none',storageEncrypted=false,updateStatus:DesktopInfo['updateStatus']='disabled',updateReady=false,pendingUpdate=false;
let updateConfiguration:TrustedUpdateConfig|null=null;
let desktopCapability='';
let startupFailureDetail='';
let log=createDiagnosticLogger(path.join(app.getPath('userData'),'diagnostics'));
const vaultDirectory=()=>path.join(app.getPath('userData'),'secure');
const preferencesPath=()=>path.join(app.getPath('userData'),'desktop-preferences.json');
const secureAdapter:SecureStorageAdapter={available:async()=>await safeStorage.isAsyncEncryptionAvailable()&&(process.platform!=='linux'||!['basic_text','unknown'].includes(safeStorage.getSelectedStorageBackend())),encrypt:value=>safeStorage.encryptStringAsync(value),decrypt:value=>safeStorage.decryptStringAsync(value)};
interface DesktopConfig {updates:TrustedUpdateConfig|null}

async function readConfiguration():Promise<DesktopConfig>{
  try{const value=JSON.parse(await readFile(path.join(app.getAppPath(),'desktop-config.json'),'utf8'));return{updates:validateUpdateConfig(value.updates)};}
  catch{return{updates:null};}
}
async function readExternalEnvironment(filename:string):Promise<ApiKeyStatus>{
  if(!path.isAbsolute(filename)||(await stat(filename)).size>65536)throw new Error('Choose a local environment file smaller than 64 KB.');
  const values=parseEnv(await readFile(filename)),apiKey=validateApiKey(values.OPENAI_API_KEY),model=validateModel(values.OPENAI_MODEL||defaultModel);process.env.OPENAI_API_KEY=apiKey;process.env.OPENAI_MODEL=model;
  return{configured:true,model:process.env.OPENAI_MODEL};
}
async function loadCredential(){
  if(!app.isPackaged&&process.env.ATELIER_ENV_FILE&&path.isAbsolute(process.env.ATELIER_ENV_FILE)){loadEnv({path:process.env.ATELIER_ENV_FILE,quiet:true,override:true});if(process.env.OPENAI_API_KEY){process.env.OPENAI_MODEL=validateModel(process.env.OPENAI_MODEL||defaultModel);keySource='development-env';return;}}
  delete process.env.OPENAI_API_KEY;delete process.env.OPENAI_MODEL;
  let preferences:{externalEnvPath?:string}={};try{preferences=JSON.parse(await readFile(preferencesPath(),'utf8'));}catch{}
  if(typeof preferences.externalEnvPath==='string'){try{await readExternalEnvironment(preferences.externalEnvPath);keySource='external-env';return;}catch{void log('external-credential-unavailable');}}
  const saved=await loadApiCredential(vaultDirectory(),secureAdapter);
  if(saved){process.env.OPENAI_API_KEY=saved.apiKey;process.env.OPENAI_MODEL=saved.model;keySource='secure-storage';}
}
const ownUrl=(value:string)=>{try{return new URL(value).origin===origin;}catch{return false;}};
function authorizedIpc(event:IpcMainEvent|IpcMainInvokeEvent){return !!window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&ownUrl(event.senderFrame?.url??'');}
async function authorizeCredentialChange(event:IpcMainInvokeEvent){
  if(!authorizedIpc(event)||!window)throw new Error('Untrusted desktop message');
  const cookies=await window.webContents.session.cookies.get({url:origin,name:'atelier_session'});
  await assertWorkspaceAdministrator(origin,desktopCapability,cookies.length===1?cookies[0].value:undefined);
  if(!authorizedIpc(event))throw new Error('Untrusted desktop message');
}
function emit(action:DesktopMenuAction){if(window&&!window.isDestroyed()&&ownUrl(window.webContents.getURL()))window.webContents.send('atelier:menu-action',action);}
async function undoOrRedo(action:'undo'|'redo'){
  if(!window||window.isDestroyed())return;
  const editable=await window.webContents.executeJavaScript("(()=>{const e=document.activeElement;return !!e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.isContentEditable)})()").catch(()=>false);
  if(editable){if(action==='undo')window.webContents.undo();else window.webContents.redo();}else emit(action);
}
function installMenu(){
  const template:MenuItemConstructorOptions[]=[
    {label:'Atelier',submenu:[{role:'about'},{label:'Check for Updates…',click:()=>{void checkTrustedUpdates(true);}},{type:'separator'},{label:'Workspace Settings…',accelerator:'CmdOrCtrl+,',click:()=>emit('settings')},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {label:'File',submenu:[{label:'New Project…',accelerator:'CmdOrCtrl+N',click:()=>emit('new-project')},{label:'Import IFC or Project…',accelerator:'CmdOrCtrl+O',click:()=>emit('import')},{type:'separator'},{label:'Save',accelerator:'CmdOrCtrl+S',click:()=>emit('save-local')},{label:'Save Project Copy…',accelerator:'CmdOrCtrl+Shift+S',click:()=>emit('save-project')},{label:'Export',submenu:[{label:'IFC Model…',click:()=>emit('export-ifc')},{label:'Review PDF…',click:()=>emit('export-pdf')},{label:'Quantity and Cost Workbook…',click:()=>emit('export-xlsx')},{type:'separator'},{label:'Encrypted Project Backup…',click:()=>emit('export-backup')}]},{label:'Restore Project Backup…',click:()=>emit('import-backup')},{type:'separator'},{role:'close'}]},
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
  if(result.response===0){closing=false;requestClose();}else if(result.response===2){allowClose=true;if(pendingUpdate){allowQuit=true;autoUpdater.quitAndInstall();}else window.close();}else{closing=false;quitRequested=false;pendingUpdate=false;}
}
function requestClose(){
  if(!window||window.isDestroyed()||closing)return;closing=true;window.webContents.send('atelier:before-close');clearCloseTimer();closeTimer=setTimeout(()=>{void closeProblem();},8000);
}
function installIpc(){
  ipcMain.handle('atelier:get-info',(event):DesktopInfo=>{if(!authorizedIpc(event))throw new Error('Untrusted desktop message');return{version:app.getVersion(),platform:process.platform,dataPath,aiConfigured:!!process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||defaultModel,storageEncrypted,keySource,updateStatus};});
  ipcMain.handle('atelier:configure-api-key',async(event,input:ApiKeyInput):Promise<ApiKeyStatus>=>{await authorizeCredentialChange(event);if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['apiKey','model'].includes(key)))throw new Error('Invalid credential input.');const credential={apiKey:validateApiKey(input.apiKey),model:validateModel(input.model||defaultModel)};await saveApiCredential(vaultDirectory(),credential,secureAdapter);await writePrivatePreferences(preferencesPath(),{version:1});process.env.OPENAI_API_KEY=credential.apiKey;process.env.OPENAI_MODEL=credential.model;keySource='secure-storage';void log('openai-credential-configured',{source:keySource});return{configured:true,model:credential.model};});
  ipcMain.handle('atelier:choose-env-file',async(event):Promise<ApiKeyStatus>=>{await authorizeCredentialChange(event);if(!window)throw new Error('Untrusted desktop message');const choice=await dialog.showOpenDialog(window,{title:'Use an existing OpenAI environment file',message:'Atelier reads this file in its private main process. Only its path is remembered; its key is not copied.',properties:['openFile','showHiddenFiles'],filters:[{name:'Environment files',extensions:['env','local']},{name:'All files',extensions:['*']}]});if(choice.canceled||!choice.filePaths[0])return{configured:!!process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||defaultModel};await authorizeCredentialChange(event);const previousKey=process.env.OPENAI_API_KEY,previousModel=process.env.OPENAI_MODEL;try{const status=await readExternalEnvironment(choice.filePaths[0]);await writePrivatePreferences(preferencesPath(),{version:1,externalEnvPath:choice.filePaths[0]});keySource='external-env';void log('openai-credential-configured',{source:keySource});return status;}catch{if(previousKey)process.env.OPENAI_API_KEY=previousKey;else delete process.env.OPENAI_API_KEY;if(previousModel)process.env.OPENAI_MODEL=previousModel;else delete process.env.OPENAI_MODEL;throw new Error('The selected environment file could not be used. Check that it contains a valid OpenAI key and model.');}});
  ipcMain.handle('atelier:clear-api-key',async(event)=>{await authorizeCredentialChange(event);await removeApiCredential(vaultDirectory());await writePrivatePreferences(preferencesPath(),{version:1});delete process.env.OPENAI_API_KEY;delete process.env.OPENAI_MODEL;keySource='none';void log('openai-credential-cleared');});
  ipcMain.on('atelier:complete-close',(event,result:CloseResult)=>{if(!authorizedIpc(event)||!closing||!result||typeof result.ok!=='boolean')return;if(result.ok){clearCloseTimer();allowClose=true;if(pendingUpdate){allowQuit=true;autoUpdater.quitAndInstall();}else window?.close();}else void closeProblem('Save failed');});
}
async function prepareUpdates(configuration:TrustedUpdateConfig|null){
  if(!configuration||!app.isPackaged||process.platform!=='darwin')return;
  try{const bundle=path.resolve(path.dirname(app.getPath('exe')),'..','..');await promisify(execFile)('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{timeout:10000});const info=await promisify(execFile)('/usr/bin/codesign',['-dv','--verbose=4',bundle],{timeout:10000});if(!info.stderr.includes(`TeamIdentifier=${configuration.teamId}`))throw new Error('Signing team mismatch');updateConfiguration=configuration;updateStatus='unavailable';autoUpdater.setFeedURL({url:configuration.feedUrl,serverType:'json'});autoUpdater.on('error',()=>{updateStatus='unavailable';void log('update-check-failed');});autoUpdater.on('update-not-available',()=>{updateStatus='up-to-date';});autoUpdater.on('update-downloaded',()=>{updateReady=true;updateStatus='available';void log('verified-update-downloaded');if(window)void dialog.showMessageBox(window,{type:'info',title:'Atelier update ready',message:'A verified update is ready to install.',detail:'Save the current workspace and restart Atelier to apply it.',buttons:['Save and Restart','Later'],defaultId:0,cancelId:1}).then(result=>{if(result.response===0&&updateReady){pendingUpdate=true;requestClose();}});});}catch{void log('automatic-updates-disabled');updateConfiguration=null;updateStatus='disabled';}
}
async function checkTrustedUpdates(interactive=false){
  if(!updateConfiguration){if(interactive&&window)await dialog.showMessageBox(window,{type:'info',title:'Atelier updates',message:'Automatic updates are not configured for this build.',detail:'Updates require a trusted HTTPS feed, a pinned publisher signature and a matching signed macOS application.'});return;}
  try{const response=await fetch(updateConfiguration.feedUrl,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||Number(response.headers.get('content-length')||0)>65536)throw new Error('Invalid update response');const body=await response.text();verifySignedUpdateFeed(body,response.headers.get('x-atelier-signature')||'',updateConfiguration);autoUpdater.checkForUpdates();}catch{updateStatus='unavailable';void log('update-feed-rejected');if(interactive&&window)await dialog.showMessageBox(window,{type:'warning',title:'Atelier updates',message:'The update feed could not be verified.',detail:'Your current application has not been changed.'});}
}
function createWindow(){
  allowClose=false;closing=false;
  window=new BrowserWindow({title:'Atelier',width:1512,height:982,minWidth:1040,minHeight:700,show:false,backgroundColor:'#f5f5f7',titleBarStyle:'hiddenInset',trafficLightPosition:{x:18,y:20},autoHideMenuBar:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),partition:productionPartition,...rendererSecurity,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,safeDialogs:true}});
  const current=window;
  current.webContents.on('console-message',event=>{if(event.level==='error'||event.level==='warning')void log('renderer-console-warning',{level:event.level});});
  current.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  current.webContents.on('will-navigate',(event,url)=>{if(!ownUrl(url))event.preventDefault();});
  current.webContents.on('will-redirect',(event,url)=>{if(!ownUrl(url))event.preventDefault();});
  current.webContents.on('will-attach-webview',event=>event.preventDefault());
  current.once('ready-to-show',()=>{if(!smokeTest)current.show();});
  current.on('close',event=>{if(allowClose)return;event.preventDefault();requestClose();});
  current.on('closed',()=>{clearCloseTimer();window=null;if(quitRequested||process.platform!=='darwin'){allowQuit=true;server?.close();app.quit();}});
  current.webContents.on('render-process-gone',(_event,details)=>{void log('renderer-process-gone',{reason:details.reason,exitCode:details.exitCode});closing=false;clearCloseTimer();void dialog.showMessageBox(current,{type:'error',title:'Workspace stopped responding',message:'The workspace renderer stopped.',detail:'Saved projects remain in your desktop data folder. Reload the workspace to recover the most recently saved model.',buttons:['Reload Workspace','Keep Open'],defaultId:0,cancelId:1}).then(result=>{if(result.response===0&&!current.isDestroyed())void current.loadURL(origin);});});
  void current.loadURL(origin);
}
async function runSmoke(token:string){
  if(!window)return;const current=window;
  await new Promise<void>(resolve=>{if(!current.webContents.isLoading())resolve();else current.webContents.once('did-finish-load',()=>resolve());});
  await new Promise(resolve=>setTimeout(resolve,1600));
  const renderer=await current.webContents.executeJavaScript("(async()=>{const info=await window.atelierDesktop.getInfo();let credentialIpcDenied=false;try{await window.atelierDesktop.configureApiKey({apiKey:''});}catch(error){credentialIpcDenied=String(error?.message||error).includes('signed-in workspace administrator');}return{credentialIpcDenied,nodeUnavailable:typeof require==='undefined'&&typeof process==='undefined',hasBridge:typeof window.atelierDesktop.configureApiKey==='function'&&typeof window.atelierDesktop.chooseEnvFile==='function',renderedApp:!!document.querySelector('#root')?.children.length,bridgeInfoValid:info.storageEncrypted===true&&typeof info.model==='string'&&!('apiKey'in info)&&!('encryptionKey'in info)}})()");
  const untrusted=await fetch(`${origin}/api/health`);const trusted=await fetch(`${origin}/api/health`,{headers:{'X-Atelier-Desktop':token}});
  const health=await trusted.json() as{encrypted?:boolean;identityRequired?:boolean};
  const rendererIdentityReady=await current.webContents.executeJavaScript("(async()=>{try{const response=await fetch('/api/auth/status',{credentials:'same-origin'});const status=await response.json();return response.ok&&status.identityRequired===true&&typeof status.setupRequired==='boolean'&&typeof status.authenticated==='boolean'&&!document.body.textContent.includes('Workspace unavailable');}catch{return false;}})()");
  const protectedProjects=await fetch(`${origin}/api/projects`,{headers:{'X-Atelier-Desktop':token}});
  const roleAssignment=await fetch(`${origin}/api/session`,{method:'POST',headers:{'X-Atelier-Desktop':token,'Content-Type':'application/json'},body:JSON.stringify({role:'admin'})});
  let fixtureAuthenticated=true;
  if(isolatedTestProfile&&process.env.ATELIER_TEST_PASSWORD){
    const status=await fetch(`${origin}/api/auth/status`,{headers:{'X-Atelier-Desktop':token}}).then(response=>response.json()) as{setupRequired:boolean};
    const endpoint=status.setupRequired?'setup':'login';
    const response=await fetch(`${origin}/api/auth/${endpoint}`,{method:'POST',headers:{'X-Atelier-Desktop':token,'Content-Type':'application/json'},body:JSON.stringify({email:'qa@atelier.test',password:process.env.ATELIER_TEST_PASSWORD,...(status.setupRequired?{name:'Isolated QA fixture'}:{})})});
    const cookie=response.headers.get('set-cookie')?.split(';')[0];
    fixtureAuthenticated=response.ok&&!!cookie&&(await fetch(`${origin}/api/projects`,{headers:{'X-Atelier-Desktop':token,Cookie:cookie||''}})).status===200;
  }
  const result={...renderer,rendererIdentityReady,contextIsolationConfigured:rendererSecurity.contextIsolation,sandboxConfigured:rendererSecurity.sandbox,loopbackProtected:untrusted.status===403,backendReady:trusted.status===200,encryptedStorage:health.encrypted===true,identityRequired:health.identityRequired===true,anonymousDenied:protectedProjects.status===401,roleAssignmentBlocked:roleAssignment.status===409,fixtureAuthenticated,packaged:app.isPackaged};
  console.log(`ATELIER_DESKTOP_SMOKE ${JSON.stringify(result)}`);
  const ok=Object.entries(result).filter(([key])=>key!=='packaged').every(([,value])=>value===true);
  allowQuit=true;allowClose=true;current.destroy();server?.close();app.exit(ok?0:1);
}

if(!app.requestSingleInstanceLock()){app.quit();}
else{
  process.on('unhandledRejection',error=>{void log('unhandled-rejection',{message:error instanceof Error?error.message:'Unknown failure'});});
  process.on('uncaughtException',error=>{void log('uncaught-main-exception',{name:error.name,message:error.message}).finally(()=>{allowQuit=true;app.exit(1);});});
  app.on('child-process-gone',(_event,details)=>{void log('child-process-gone',{type:details.type,reason:details.reason,exitCode:details.exitCode});});
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}else if(origin)createWindow();});
  app.on('before-quit',event=>{quitRequested=true;if(!allowQuit&&window&&!window.isDestroyed()&&!allowClose){event.preventDefault();requestClose();}else server?.close();});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin'){allowQuit=true;server?.close();app.quit();}});
  app.on('activate',()=>{if(!window&&origin)createWindow();});
  void app.whenReady().then(async()=>{
    const configuration=await readConfiguration();
    const encryptionKey=await getProfileDataKey(app.getPath('userData'),secureAdapter);storageEncrypted=true;
    try{const preserved=await preserveLegacyLocalStorage(app.getPath('userData'),encryptionKey,()=>session.fromPartition('persist:atelier-workspace').clearStorageData({storages:['localstorage']}));if(preserved)await log('legacy-localstorage-preserved',{fileCount:preserved.fileCount});}catch(error){startupFailureDetail='Atelier could not safely preserve the previous local draft cache. Check folder access and the 128 MB preservation limit before retrying. Cache files are removed only after an encrypted recovery archive has been written and verified. No model is loaded from the old plaintext cache.';throw error;}
    await loadCredential();
    dataPath=path.join(app.getPath('userData'),'projects');
    const token=randomBytes(32).toString('hex');desktopCapability=token;
    const backend=createApp({dataDir:dataPath,staticDir:path.join(app.getAppPath(),'dist'),mode:'desktop',requireIdentity:true,encryptionKey,desktopHeaderToken:token});
    server=await new Promise<Server>((resolve,reject)=>{const instance=backend.listen(0,'127.0.0.1',()=>resolve(instance));instance.once('error',reject);});
    const address=server.address();if(!address||typeof address==='string')throw new Error('Could not allocate desktop backend');origin=`http://127.0.0.1:${address.port}`;
    const desktopSession=session.fromPartition(productionPartition);
    desktopSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));desktopSession.setPermissionCheckHandler(()=>false);
    desktopSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>callback({cancel:!ownUrl(details.url)&&!details.url.startsWith('data:')&&!details.url.startsWith(`blob:${origin}/`)}));
    desktopSession.webRequest.onBeforeSendHeaders({urls:[`${origin}/*`]},(details,callback)=>{const headers=Object.fromEntries(Object.entries(details.requestHeaders).filter(([key])=>key.toLowerCase()!=='x-atelier-desktop'));callback({requestHeaders:{...headers,'X-Atelier-Desktop':token}});});
    desktopSession.on('will-download',(_event,item,contents)=>{if(!window||contents!==window.webContents){item.cancel();return;}const filename=path.basename(item.getFilename())||'Atelier export';item.setSaveDialogOptions({title:'Save Atelier Export',defaultPath:path.join(app.getPath('downloads'),filename),buttonLabel:'Save',properties:['showOverwriteConfirmation']});});
    try{await assertDesktopBackendReady(origin,token);}catch(error){if(error instanceof DesktopStartupError)startupFailureDetail=error.message;throw error;}
    await prepareUpdates(configuration.updates);installIpc();installMenu();createWindow();void log('desktop-ready',{version:app.getVersion(),platform:process.platform,encrypted:true});console.log('Atelier desktop backend is ready.');
    if(updateConfiguration&&!smokeTest)void checkTrustedUpdates();
    if(smokeTest)await runSmoke(token);
  }).catch(async error=>{await log('desktop-start-failed',{message:error instanceof Error?error.message:'Unknown startup failure'});if(!smokeTest)dialog.showErrorBox('Atelier could not start',startupFailureDetail||'The desktop workspace could not start. Unlock the operating system secure credential store and confirm that the application data folder is writable. Existing encrypted projects have not been replaced.');allowQuit=true;app.exit(1);});
}
